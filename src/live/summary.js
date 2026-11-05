import { db } from '../db/index.js';
import { commentary } from '../db/schema.js';
import { eq, count } from 'drizzle-orm';

// Finished matches ingested from ESPN have no play-by-play, so we generate a
// short highlights feed from the final score: the goals/baskets/runs that made
// up the result plus a full-time conclusion. Keeps the detail view from being
// an empty slate.

function spreadMinutes(n, min, max) {
  const minutes = [];
  for (let i = 0; i < n; i += 1) {
    minutes.push(min + Math.floor(Math.random() * (max - min + 1)));
  }
  return minutes.sort((a, b) => a - b);
}

function resultMessage(match) {
  const { homeTeam: home, awayTeam: away, homeScore: h, awayScore: a } = match;
  if (h > a) return `${home} claim the win`;
  if (a > h) return `${away} claim the win`;
  return `Honours even between ${home} and ${away}`;
}

function footballHighlights(match) {
  const { homeTeam: home, awayTeam: away, homeScore, awayScore } = match;
  const entries = [
    { minute: 1, eventType: 'kickoff', team: home, message: `Kickoff: ${home} vs ${away}` },
  ];

  const goals = [
    ...Array(homeScore).fill(home),
    ...Array(awayScore).fill(away),
  ];
  const minutes = spreadMinutes(goals.length, 4, 88);
  let h = 0;
  let a = 0;
  for (let i = 0; i < goals.length; i += 1) {
    const team = goals[i];
    if (team === home) h += 1;
    else a += 1;
    entries.push({
      minute: minutes[i],
      eventType: 'goal',
      team,
      message: `GOAL! ${team} (${home} ${h}-${a} ${away})`,
    });
  }

  const halfHome = goals.filter((team, i) => team === home && minutes[i] <= 45).length;
  const halfAway = goals.filter((team, i) => team !== home && minutes[i] <= 45).length;
  entries.push({
    minute: 45,
    eventType: 'default',
    message: `Half Time: ${home} ${halfHome}-${halfAway} ${away}`,
  });
  entries.push({
    minute: 90,
    eventType: 'default',
    message: `Full Time: ${home} ${homeScore}-${awayScore} ${away}`,
  });
  entries.push({ minute: 90, eventType: 'default', message: resultMessage(match) });

  return entries;
}

function pointsSequence(total) {
  const plays = [];
  let remaining = total;
  while (remaining >= 3 && Math.random() < 0.4) {
    plays.push(3);
    remaining -= 3;
  }
  while (remaining >= 2) {
    plays.push(2);
    remaining -= 2;
  }
  if (remaining === 1) plays.push(1);
  return plays;
}

function basketballHighlights(match) {
  const { homeTeam: home, awayTeam: away, homeScore, awayScore } = match;
  const entries = [
    { minute: 1, eventType: 'tipoff', team: home, message: `Tipoff: ${home} vs ${away}` },
  ];

  const plays = [];
  for (const team of [home, away]) {
    const total = team === home ? homeScore : awayScore;
    for (const pts of pointsSequence(total)) {
      plays.push({ team, pts });
    }
  }

  const minutes = spreadMinutes(plays.length, 2, 46);
  plays.forEach((play, i) => { play.minute = minutes[i]; });
  plays.sort((a, b) => a.minute - b.minute);

  const playLabel = (pts) => (pts === 3 ? 'THREE!' : pts === 2 ? 'BASKET!' : 'FREE THROW!');
  const playType = (pts) => (pts === 3 ? 'three' : pts === 2 ? 'basket' : 'free_throw');

  let h = 0;
  let a = 0;
  for (const play of plays) {
    if (play.team === home) h += play.pts;
    else a += play.pts;
    entries.push({
      minute: play.minute,
      eventType: playType(play.pts),
      team: play.team,
      message: `${playLabel(play.pts)} ${play.team} (${home} ${h}-${a} ${away})`,
    });
  }

  for (const q of [1, 2, 3]) {
    const qMinute = q * 12;
    const qHome = plays.filter((p) => p.minute <= qMinute && p.team === home)
      .reduce((sum, p) => sum + p.pts, 0);
    const qAway = plays.filter((p) => p.minute <= qMinute && p.team === away)
      .reduce((sum, p) => sum + p.pts, 0);
    entries.push({
      minute: qMinute,
      eventType: 'default',
      message: `End of Q${q}: ${home} ${qHome}-${qAway} ${away}`,
    });
  }

  entries.push({
    minute: 48,
    eventType: 'default',
    message: `Final: ${home} ${homeScore}-${awayScore} ${away}`,
  });
  entries.push({ minute: 48, eventType: 'default', message: resultMessage(match) });

  return entries;
}

function cricketHighlights(match) {
  const { homeTeam: home, awayTeam: away, result } = match;
  const entries = [
    { period: 'Match', eventType: 'start', team: home, message: `The match begins: ${home} vs ${away}` },
    ...cricketInnings(match, home),
    ...cricketInnings(match, away),
    {
      period: 'Match',
      eventType: 'default',
      message: `Full Time: ${home} ${match.homeRuns}/${match.homeWickets} v ${away} ${match.awayRuns}/${match.awayWickets}`,
    },
    {
      period: 'Match',
      eventType: 'default',
      message: result
        ? `That's the match — ${result}`
        : `That's the match — ${home} ${match.homeRuns}/${match.homeWickets} v ${away} ${match.awayRuns}/${match.awayWickets}`,
    },
  ];
  return entries;
}

// Builds a plausible ball-by-ball innings for one team. Cricket innings scores
// on ESPN arrive as a single runs/wickets pair, so we reconstruct the feed from
// boundaries, singles and wickets that add up to that scorecard line.
function cricketInnings(match, team) {
  const isHome = team === match.homeTeam;
  const runs = isHome ? match.homeRuns : match.awayRuns;
  const wickets = isHome ? match.homeWickets : match.awayWickets;
  const period = `${team} innings`;

  const entries = [
    { period, eventType: 'start', team, message: `${team} start their innings` },
  ];
  if (runs === 0 && wickets === 0) {
    entries.push({ period, eventType: 'default', team, message: `${team} yet to bat` });
    return entries;
  }

  // A sequence of scoring shots summing exactly to `runs`, capped at ~28 shots
  // so long Test innings don't flood the feed (the remainder becomes a cluster).
  const seq = [];
  let remaining = runs;
  while (remaining > 0) {
    let value;
    if (remaining >= 6 && Math.random() < 0.45) value = 6;
    else if (remaining >= 4 && Math.random() < 0.6) value = 4;
    else if (remaining >= 2 && Math.random() < 0.55) value = 2;
    else value = 1;
    if (value > remaining) value = remaining;
    if (seq.length >= 28) {
      seq.push({ value: remaining, cluster: true });
      remaining = 0;
      break;
    }
    seq.push({ value });
    remaining -= value;
  }

  const wicketPositions = new Set();
  let toPlace = wickets;
  while (toPlace > 0 && seq.length > 0) {
    const p = Math.floor(Math.random() * seq.length);
    if (!wicketPositions.has(p)) {
      wicketPositions.add(p);
      toPlace -= 1;
    }
  }

  let r = 0;
  let w = 0;
  for (let i = 0; i < seq.length; i += 1) {
    if (wicketPositions.has(i)) {
      w += 1;
      entries.push({ period, eventType: 'wicket', team, message: `WICKET! ${team} (${team} ${r}/${w})` });
    }
    if (w >= 10) break;

    const { value, cluster } = seq[i];
    r += value;
    if (value === 6) {
      entries.push({ period, eventType: 'six', team, message: `SIX! ${team} (${team} ${r}/${w})` });
    } else if (value === 4) {
      entries.push({ period, eventType: 'four', team, message: `FOUR! ${team} (${team} ${r}/${w})` });
    } else if (cluster) {
      entries.push({ period, eventType: 'run', team, message: `${team} add ${value} runs (${team} ${r}/${w})` });
    } else if (value >= 2) {
      entries.push({ period, eventType: 'run', team, message: `${team} work ${value} runs (${team} ${r}/${w})` });
    } else {
      entries.push({ period, eventType: 'run', team, message: `Single: ${team} (${team} ${r}/${w})` });
    }
  }

  entries.push({ period, eventType: 'default', team, message: `Innings break: ${team} ${runs}/${wickets}` });
  return entries;
}

export function buildHighlights(match) {
  if (match.sport?.toLowerCase() === 'cricket') {
    return cricketHighlights(match);
  }
  if (match.sport?.toLowerCase() === 'basketball') {
    return basketballHighlights(match);
  }
  return footballHighlights(match);
}

// Insert a highlights feed for a finished match if it doesn't have commentary
// yet. Returns the inserted rows (empty when nothing was generated).
export async function ensureMatchSummary(match, { broadcastCommentary, result } = {}) {
  if (match.status !== 'finished') return [];

  const [{ n }] = await db
    .select({ n: count() })
    .from(commentary)
    .where(eq(commentary.matchId, match.id));
  if (n > 0) return [];

  const entries = buildHighlights({ ...match, result })
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
    .map((entry, i) => ({
      matchId: match.id,
      sequence: i + 1,
      minute: entry.minute ?? null,
      period: entry.period ?? null,
      eventType: entry.eventType ?? null,
      team: entry.team ?? null,
      message: entry.message,
    }));

  const inserted = await db.insert(commentary).values(entries).returning();
  for (const row of inserted) {
    if (broadcastCommentary) broadcastCommentary(match.id, row);
  }
  return inserted;
}
