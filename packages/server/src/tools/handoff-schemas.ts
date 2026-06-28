import { z } from "zod";

export const HandoffInput = z.object({
  scope: z.string().optional(),
  budgetTokens: z
    .number()
    .int()
    .positive()
    .max(20000)
    .optional()
    .default(3000),
  since: z
    .string()
    .optional()
    .describe(
      "How far back to look for recent activity. E.g. '1h', '1d', '7d', or an ISO date. Default '3d'."
    ),
});

export const DiffInput = z.object({
  scope: z.string().optional(),
  since: z
    .string()
    .optional()
    .describe(
      "How far back to look. E.g. '1h', '1d', '7d', or an ISO date. Default '1d'."
    ),
});

export const ReplayInput = z.object({
  scope: z.string().optional(),
  limit: z.number().int().positive().max(500).optional().default(100),
});
