import { z } from 'zod';

export const MAX_COMMENTARY_LIMIT = 100;

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_COMMENTARY_LIMIT).optional(),
});

export const createCommentarySchema = z.object({
  minutes: z.number().int().nonnegative(),
  sequence: z.string().optional(),
  period: z.string().min(1),
  eventType: z.string().min(1),
  actor: z.string().min(1),
  team: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.any()),
  tags: z.array(z.string()),
});