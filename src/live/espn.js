import { fetch as httpFetch } from 'undici';

// Real live scores are ingested from ESPN's public (undocumented) scoreboard
// endpoints. Cricket has no working scoreboard endpoint on ESPN right now, so
// this covers football (soccer) and basketball. Note: this module must use
// undici's fetch directly — src/db/index.js overrides globalThis.fetch to
// route through Neon, which would hijack these HTTP calls.
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
