import { Router } from 'express';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import { createMatchSchema } from '../validation/matches.js';
import { getMatchStatus } from '../utils/match-status.js';
import { z } from 'zod';
import { listMatchesQuerySchema } from '../validation/matches.js';
import { desc } from 'drizzle-orm';


export const matchRouter = Router();



matchRouter.get('/', async (req, res) => {
  const parsed = listMatchesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid query.',
      details: JSON.stringify(parsed.error)
    });
  }

  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(matches)
      .orderBy(desc(matches.createdAt))
      .limit(limit);

    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list matches.' });
  }
});




matchRouter.post('/', async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);
  const { data: { startTime, endTime, homeScore, awayScore } } = parsed;

  if (!parsed.success) {
    // handle validation error
    return res.status(400).json({ error: 'Invalid input', details: parsed.error });
  }

  try {
    const [event] = await db.insert(matches).values({
      ...parsed.data,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      homeScore: homeScore ?? 0,
      awayScore: awayScore ?? 0,
      status: getMatchStatus(startTime, endTime),
    }).returning();

    res.status(201).json({ data: event });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create match.', details: JSON.stringify(e) });
  }
});
