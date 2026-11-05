import { fetch as httpFetch } from 'undici';

// Real live scores are ingested from ESPN's public (undocumented) endpoints.
// Football (soccer) and basketball come from the v2 scoreboard API; cricket has
// no working v2 scoreboard, so we use the personalized scoreboard header, which
// lists every active series and its matches with live scores. Note: this module
// must use undici's fetch directly — src/db/index.js overrides
// globalThis.fetch to route through Neon, which would hijack these HTTP calls.
const LEAGUES = [
  { espnSport: 'soccer', sport: 'football', league: 'eng.1' },
  { espnSport: 'soccer', sport: 'football', league: 'ger.1' },
  { espnSport: 'soccer', sport: 'football', league: 'esp.1' },
  { espnSport: 'soccer', sport: 'football', league: 'ita.1' },
  { espnSport: 'soccer', sport: 'football', league: 'fra.1' },
  { espnSport: 'soccer', sport: 'football', league: 'usa.1' },
  { espnSport: 'soccer', sport: 'football', league: 'bra.1' },
  { espnSport: 'soccer', sport: 'football', league: 'arg.1' },
  { espnSport: 'soccer', sport: 'football', league: 'mex.1' },
  { espnSport: 'soccer', sport: 'football', league: 'ned.1' },
  { espnSport: 'soccer', sport: 'football', league: 'por.1' },
  { espnSport: 'basketball', sport: 'basketball', league: 'nba' },
  { espnSport: 'basketball', sport: 'basketball', league: 'wnba' },
];

const STATUS_MAP = { pre: 'scheduled', in: 'live', post: 'finished' };

// Approximate real-world durations used to derive end_time until a game posts.
const SPORT_DURATION_MIN = { football: 120, basketball: 165 };

function teamName(competitor) {
  return (
    competitor?.team?.displayName ??
    competitor?.team?.shortDisplayName ??
    competitor?.team?.abbreviation ??
    'Unknown'
  );
}

export async function fetchEspnScoreboards({ signal } = {}) {
  const games = [];

  for (const { espnSport, sport, league } of LEAGUES) {
    let leagueName = league;
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${league}/scoreboard`;
      const res = await httpFetch(url, { signal });
      if (!res.ok) continue;
      const json = await res.json();
      leagueName = json.leagues?.[0]?.name ?? league;

      for (const event of json.events ?? []) {
        const competition = event.competitions?.[0];
        if (!competition) continue;

        const state = event.status?.type?.state;
        const status = STATUS_MAP[state];
        if (!status) continue;

        const home = competition.competitors?.find((c) => c.homeAway === 'home');
        const away = competition.competitors?.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;

        const startTime = new Date(event.date ?? competition.date);
        if (Number.isNaN(startTime.getTime())) continue;

        const durationMin = SPORT_DURATION_MIN[sport] ?? 120;
        let endTime = new Date(startTime.getTime() + durationMin * 60000);
        if (status === 'finished' && endTime.getTime() > Date.now()) {
          endTime = new Date();
        }

        games.push({
          externalId: `espn:${league}:${event.id}`,
          sport,
          league,
          leagueName,
          homeTeam: teamName(home),
          awayTeam: teamName(away),
          homeScore: Number.parseInt(home.score ?? '0', 10) || 0,
          awayScore: Number.parseInt(away.score ?? '0', 10) || 0,
          startTime,
          endTime,
          status,
        });
      }
    } catch {
      // A league may be unreachable or the endpoint may change; skip it.
    }
  }

  return games;
}

const CRICKET_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&tz=Asia/Calcutta';

// Cricket innings scores come back as strings like "198 & 51/2 (17 ov)",
// "426", "54/7 (7.4/8 ov, target 52)". Reduce them to the current/latest
// innings; a plain total is treated as a completed innings (10 wickets).
function parseCricketScore(score) {
  if (!score) return { runs: 0, wickets: 0 };
  const last = String(score).split('&').pop();
  const bare = last.replace(/\s*\(.*\)\s*$/, '').trim();
  const [runs, wickets] = bare.split('/');
  const runsNum = Number.parseInt(runs, 10) || 0;
  if (wickets == null) return { runs: runsNum, wickets: 10 };
  return { runs: runsNum, wickets: Number.parseInt(wickets, 10) || 0 };
}

export async function fetchEspnCricketScoreboard({ signal } = {}) {
  const games = [];

  try {
    const res = await httpFetch(CRICKET_SCOREBOARD_URL, { signal });
    if (!res.ok) return games;
    const json = await res.json();

    for (const league of json.sports?.[0]?.leagues ?? []) {
      const leagueName = league.name ?? 'Cricket';
      for (const event of league.events ?? []) {
        const status = STATUS_MAP[event.status];
        if (!status) continue;

        const home = event.competitors?.find((c) => c.homeAway === 'home');
        const away = event.competitors?.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;

        const startTime = new Date(event.date);
        if (Number.isNaN(startTime.getTime())) continue;

        let endTime = new Date(event.endDate ?? event.date);
        if (Number.isNaN(endTime.getTime())) {
          endTime = new Date(startTime.getTime() + 6 * 3600000);
        }
        if (status === 'finished' && endTime.getTime() > Date.now()) {
          endTime = new Date();
        }

        const homeScore = parseCricketScore(home.score);
        const awayScore = parseCricketScore(away.score);

        games.push({
          externalId: `espn:cricket:${league.id}:${event.id}`,
          sport: 'cricket',
          league: String(league.id),
          leagueName,
          homeTeam: home.displayName ?? home.name ?? 'Unknown',
          awayTeam: away.displayName ?? away.name ?? 'Unknown',
          homeScore: 0,
          awayScore: 0,
          homeRuns: homeScore.runs,
          homeWickets: homeScore.wickets,
          awayRuns: awayScore.runs,
          awayWickets: awayScore.wickets,
          result: event.fullStatus?.longSummary ?? null,
          startTime,
          endTime,
          status,
        });
      }
    }
  } catch {
    // The cricket header may be unreachable; return what we collected.
  }

  return games;
}
