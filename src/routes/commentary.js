import { Router } from 'express';
import { db } from '../db/index.js';
import { commentary } from '../db/schema.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';
import { desc, eq } from 'drizzle-orm';
import { MAX_LIMIT } from '../constants.js';

export const commentaryRouter = Router();

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
        minute: minutes,
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

      if(res.app.locals.broadcastCommentary) {
        res.app.locals.broadcastCommentary(result.matchId, result);
      }
    res.status(201).json({ data: result });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to create commentary.',
      details: JSON.stringify(e),
    });
  }
});