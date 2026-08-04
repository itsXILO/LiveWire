import { Router } from 'express';
import { db } from '../db/index.js';
import { commentary } from '../db/schema.js';
import { createCommentarySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';

export const commentaryRouter = Router();

commentaryRouter.post('/:id', async (req, res) => {
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

    res.status(201).json({ data: result });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to create commentary.',
      details: JSON.stringify(e),
    });
  }
});