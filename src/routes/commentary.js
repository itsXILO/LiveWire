import { Router } from 'express';
import { db } from '../db/index.js';
import { commentary, matches } from '../db/schema.js';
import { createCommentarySchema, createCommentaryBatchSchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';
import { desc, eq } from 'drizzle-orm';
import { MAX_LIMIT } from '../constants.js';
import { applyScoreDelta, scoreFromEvent } from '../utils/score.js';

export const commentaryRouter = Router();

const emptyDelta = () => ({
  homeScore: 0,
  awayScore: 0,
  homeRuns: 0,
  homeWickets: 0,
  awayRuns: 0,
  awayWickets: 0,
});

commentaryRouter.get('/:id/commentary', async (req, res) => {
  const idParams = matchIdParamSchema.safeParse(req.params);
  const query = listCommentaryQuerySchema.safeParse(req.query);

  if (!idParams.success) {
    return res.status(400).json({
      error: 'Invalid match id.',
      details: JSON.stringify(idParams.error),
    });
  }

  if (!query.success) {
    return res.status(400).json({
      error: 'Invalid query.',
      details: JSON.stringify(query.error),
    });
  }

  const { id } = idParams.data;
  const limit = Math.min(query.data.limit ?? MAX_LIMIT, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(commentary)
      .where(({ matchId }) => eq(matchId, id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    res.json({ data });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to list commentary.',
      details: JSON.stringify(e),
    });
  }
});

commentaryRouter.post('/:id/commentary', async (req, res) => {
  const idParams = matchIdParamSchema.safeParse(req.params);
  const body = createCommentarySchema.safeParse(req.body);

  if (!idParams.success) {
    return res.status(400).json({
      error: 'Invalid match id.',
      details: JSON.stringify(idParams.error),
    });
  }

  if (!body.success) {
    return res.status(400).json({
      error: 'Invalid input.',
      details: JSON.stringify(body.error),
    });
  }

  const { id } = idParams.data;
  const {
    minutes,
    minute,
    sequence,
    period,
    eventType,
    actor,
    team,
    message,
    metadata,
    tags,
  } = body.data;

  try {
    const [result] = await db
      .insert(commentary)
      .values({
        matchId: id,
        minute: minutes ?? minute,
        sequence: sequence ? parseInt(sequence, 10) : 0,
        period,
        eventType,
        actor,
        team,
        message,
        metadata,
        tags,
      })
      .returning();

    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id));

    if (matchRow) {
      const delta = scoreFromEvent(matchRow.sport, result.team, result.eventType, matchRow);
      await applyScoreDelta(db, matchRow.id, delta);

      const [updatedMatch] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, id));

      if (res.app.locals.broadcastCommentary) {
        res.app.locals.broadcastCommentary(result.matchId, result);
      }
      if (res.app.locals.broadcastMatchUpdate) {
        res.app.locals.broadcastMatchUpdate(updatedMatch.id, updatedMatch);
      }
    }

    res.status(201).json({ data: result });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to create commentary.',
      details: JSON.stringify(e),
    });
  }
});

// Bulk-ingest commentary for a match in a single request. Used by the seeder
// so finished matches can get their full final scores without thousands of
// slow round-trips.
commentaryRouter.post('/:id/commentary/batch', async (req, res) => {
  const idParams = matchIdParamSchema.safeParse(req.params);
  const body = createCommentaryBatchSchema.safeParse(req.body);

  if (!idParams.success) {
    return res.status(400).json({
      error: 'Invalid match id.',
      details: JSON.stringify(idParams.error),
    });
  }

  if (!body.success) {
    return res.status(400).json({
      error: 'Invalid input.',
      details: JSON.stringify(body.error),
    });
  }

  const { id } = idParams.data;
  const { entries } = body.data;

  try {
    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id));

    if (!matchRow) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    const values = entries.map((entry) => ({
      matchId: id,
      minute: entry.minutes ?? entry.minute,
      sequence: entry.sequence ? parseInt(entry.sequence, 10) : 0,
      period: entry.period,
      eventType: entry.eventType,
      actor: entry.actor,
      team: entry.team,
      message: entry.message,
      metadata: entry.metadata,
      tags: entry.tags,
    }));

    const inserted = await db
      .insert(commentary)
      .values(values)
      .returning();

    const delta = entries.reduce((acc, entry) => {
      const d = scoreFromEvent(matchRow.sport, entry.team, entry.eventType, matchRow);
      for (const key of Object.keys(emptyDelta())) {
        acc[key] += d[key];
      }
      return acc;
    }, emptyDelta());

    await applyScoreDelta(db, id, delta);

    const [updatedMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id));

    if (res.app.locals.broadcastCommentary) {
      for (const row of inserted) {
        res.app.locals.broadcastCommentary(id, row);
      }
    }
    if (res.app.locals.broadcastMatchUpdate) {
      res.app.locals.broadcastMatchUpdate(id, updatedMatch);
    }

    res.status(201).json({ data: inserted, match: updatedMatch });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to create commentary batch.',
      details: JSON.stringify(e),
    });
  }
});