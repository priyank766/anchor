import { z } from "zod";

export const MemoryTypeSchema = z.enum(["fact", "decision", "episode", "artifact"]);

export const RememberInput = z.object({
  type: MemoryTypeSchema,
  content: z.string().min(1).max(8000),
  rationale: z.string().max(4000).optional(),
  ref: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  files: z.array(z.string()).max(20).optional(),
  scope: z.string().optional(),
  agent: z.string().default("unknown"),
  sessionId: z.string().optional(),
});

export const RecallInput = z.object({
  query: z.string().min(1).max(2000),
  scope: z.string().optional(),
  budgetTokens: z.number().int().positive().max(20000).optional(),
});

export const ForgetInput = z.object({
  id: z.string().min(1),
});

export const ListInput = z.object({
  scope: z.string().optional(),
  type: MemoryTypeSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const ScopeInput = z.object({
  path: z.string().min(1),
});
