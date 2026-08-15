import { z } from 'zod';

export const MAX_COMMENTARY_LIMIT = 100;

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_COMMENTARY_LIMIT).optional(),
});

export const createCommentarySchema = z.object({
  minute: z.number().int().nonnegative().optional(),
  minutes: z.number().int().nonnegative().optional(),
  sequence: z.union([z.string(), z.number()]).optional(),
  period: z.string().optional(),
  eventType: z.string().optional(),
  actor: z.string().optional(),
  team: z.string().optional(),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

export const createCommentaryBatchSchema = z.object({
  entries: z.array(createCommentarySchema).min(1).max(100),
});