import { db } from '../db/index.js';
import { matches } from '../db/schema.js';
import { eq, isNotNull } from 'drizzle-orm';
import { fetchEspnScoreboards, fetchEspnCricketScoreboard } from './espn.js';
import { ensureMatchSummary } from './summary.js';

// Upsert real matches from ESPN into the database and broadcast changes over
// WebSocket so connected clients see live score updates.
export async function syncLiveMatches({ broadcastMatchCreated, broadcastMatchUpdate, broadcastCommentary, log = console } = {}) {
  const [games, cricketGames] = await Promise.all([
    fetchEspnScoreboards(),
    fetchEspnCricketScoreboard(),
  ]);
  const allGames = [...games, ...cricketGames];
  if (allGames.length === 0) {
    return { created: 0, updated: 0, total: 0 };
  }

  const existing = await db.select().from(matches).where(isNotNull(matches.externalId));
  const byExternalId = new Map(existing.map((m) => [m.externalId, m]));

  let created = 0;
  let updated = 0;

  for (const game of allGames) {
    const current = byExternalId.get(game.externalId);
    const cricket = game.sport?.toLowerCase() === 'cricket';

    if (!current) {
      const [row] = await db.insert(matches).values({
        externalId: game.externalId,
        sport: game.sport,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        startTime: game.startTime,
        endTime: game.endTime,
        homeScore: game.homeScore ?? 0,
        awayScore: game.awayScore ?? 0,
        homeRuns: game.homeRuns ?? 0,
        homeWickets: game.homeWickets ?? 0,
        awayRuns: game.awayRuns ?? 0,
        awayWickets: game.awayWickets ?? 0,
      }).returning();

      created += 1;
      if (broadcastMatchCreated) broadcastMatchCreated(row);
      await ensureMatchSummary(row, { broadcastCommentary, result: game.result });
      continue;
    }

    const changed =
      current.status !== game.status ||
      current.homeTeam !== game.homeTeam ||
      current.awayTeam !== game.awayTeam ||
      current.homeScore !== (game.homeScore ?? 0) ||
      current.awayScore !== (game.awayScore ?? 0) ||
      (cricket && current.homeRuns !== (game.homeRuns ?? 0)) ||
      (cricket && current.homeWickets !== (game.homeWickets ?? 0)) ||
      (cricket && current.awayRuns !== (game.awayRuns ?? 0)) ||
      (cricket && current.awayWickets !== (game.awayWickets ?? 0)) ||
      new Date(current.startTime).getTime() !== game.startTime.getTime() ||
      new Date(current.endTime).getTime() !== game.endTime.getTime();

    let match = current;
    if (changed) {
      const [row] = await db.update(matches)
        .set({
          sport: game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          status: game.status,
          startTime: game.startTime,
          endTime: game.endTime,
          homeScore: game.homeScore ?? 0,
          awayScore: game.awayScore ?? 0,
          homeRuns: game.homeRuns ?? 0,
          homeWickets: game.homeWickets ?? 0,
          awayRuns: game.awayRuns ?? 0,
          awayWickets: game.awayWickets ?? 0,
        })
        .where(eq(matches.externalId, game.externalId))
        .returning();

      updated += 1;
      match = row;
      if (broadcastMatchUpdate) broadcastMatchUpdate(row.id, row);
    }

    // Back-fill a highlights feed once a match reaches full time.
    if (game.status === 'finished') {
      await ensureMatchSummary(match, { broadcastCommentary, result: game.result });
    }
  }

  return { created, updated, total: allGames.length };
}
