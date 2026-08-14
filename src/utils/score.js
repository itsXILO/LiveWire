import { eq, sql } from 'drizzle-orm';
import { matches } from '../db/schema.js';

export function scoreFromEvent(sport, team, eventType, match) {
  const isHome = team === match.homeTeam;
  const isAway = team === match.awayTeam;
  const delta = {
    homeScore: 0,
    awayScore: 0,
    homeRuns: 0,
    homeWickets: 0,
    awayRuns: 0,
    awayWickets: 0,
  };

  if (!isHome && !isAway) {
    return delta;
  }

  const game = String(sport).toLowerCase();

  if (game === 'cricket') {
    if (eventType === 'six') delta[isHome ? 'homeRuns' : 'awayRuns'] = 6;
    else if (eventType === 'four' || eventType === 'boundary') {
      delta[isHome ? 'homeRuns' : 'awayRuns'] = 4;
    } else if (eventType === 'run') {
      delta[isHome ? 'homeRuns' : 'awayRuns'] = 1;
    } else if (eventType === 'wicket') {
      delta[isHome ? 'homeWickets' : 'awayWickets'] = 1;
    }
    return delta;
  }

  let points = 0;
  if (game === 'basketball') {
    if (eventType === 'basket') points = 2;
    else if (eventType === 'three') points = 3;
    else if (eventType === 'free_throw') points = 1;
  } else if (eventType === 'goal' || eventType === 'penalty') {
    points = 1;
  }

  if (points) {
    delta[isHome ? 'homeScore' : 'awayScore'] = points;
  }
  return delta;
}

export function applyScoreDelta(db, matchId, delta) {
  const updates = {};
  if (delta.homeScore) updates.homeScore = sql`${matches.homeScore} + ${delta.homeScore}`;
  if (delta.awayScore) updates.awayScore = sql`${matches.awayScore} + ${delta.awayScore}`;
  if (delta.homeRuns) updates.homeRuns = sql`${matches.homeRuns} + ${delta.homeRuns}`;
  if (delta.homeWickets) {
    updates.homeWickets = sql`LEAST(${matches.homeWickets} + ${delta.homeWickets}, 10)`;
  }
  if (delta.awayRuns) updates.awayRuns = sql`${matches.awayRuns} + ${delta.awayRuns}`;
  if (delta.awayWickets) {
    updates.awayWickets = sql`LEAST(${matches.awayWickets} + ${delta.awayWickets}, 10)`;
  }

  if (Object.keys(updates).length === 0) {
    return null;
  }

  return db.update(matches).set(updates).where(eq(matches.id, matchId));
}

export function applyScoreTotals(delta, totals) {
  totals.homeScore += delta.homeScore;
  totals.awayScore += delta.awayScore;
  totals.homeRuns += delta.homeRuns;
  totals.homeWickets = Math.min(10, totals.homeWickets + delta.homeWickets);
  totals.awayRuns += delta.awayRuns;
  totals.awayWickets = Math.min(10, totals.awayWickets + delta.awayWickets);
  return totals;
}