import { z } from "zod";

export const SummaryInputSchema = z.object({
  context: z.record(z.unknown()),
});

export const SummaryOutputSchema = z.object({
  summary: z.string().min(1),
});

export type SummaryInput = z.infer<typeof SummaryInputSchema>;
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;
