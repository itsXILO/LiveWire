import { db } from '../db/index.js';
import { matches } from '../db/schema.js';
import { eq, isNotNull } from 'drizzle-orm';
import { fetchEspnScoreboards } from './espn.js';

// Upsert real matches from ESPN into the database and broadcast changes over
// WebSocket so connected clients see live score updates.
export async function syncLiveMatches({ broadcastMatchCreated, broadcastMatchUpdate, log = console } = {}) {
  const games = await fetchEspnScoreboards();
  if (games.length === 0) {
    return { created: 0, updated: 0, total: 0 };
  }

  const existing = await db.select().from(matches).where(isNotNull(matches.externalId));
  const byExternalId = new Map(existing.map((m) => [m.externalId, m]));

  let created = 0;
  let updated = 0;

  for (const game of games) {
    const current = byExternalId.get(game.externalId);

    if (!current) {
      const [row] = await db.insert(matches).values({
        externalId: game.externalId,
        sport: game.sport,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        startTime: game.startTime,
        endTime: game.endTime,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      }).returning();

      created += 1;
      if (broadcastMatchCreated) broadcastMatchCreated(row);
      continue;
    }

    const changed =
      current.status !== game.status ||
      current.homeTeam !== game.homeTeam ||
      current.awayTeam !== game.awayTeam ||
      current.homeScore !== game.homeScore ||
      current.awayScore !== game.awayScore ||
      new Date(current.startTime).getTime() !== game.startTime.getTime() ||
      new Date(current.endTime).getTime() !== game.endTime.getTime();

    if (changed) {
      const [row] = await db.update(matches)
        .set({
          sport: game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          status: game.status,
          startTime: game.startTime,
          endTime: game.endTime,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        })
        .where(eq(matches.externalId, game.externalId))
        .returning();

      updated += 1;
      if (broadcastMatchUpdate) broadcastMatchUpdate(row.id, row);
    }
  }

  return { created, updated, total: games.length };
}
