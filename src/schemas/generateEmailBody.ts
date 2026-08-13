import { z } from "zod";

export const GenerateEmailBodyInputSchema = z.object({
  request_text: z.string().min(1),
  sentiment: z.number().int().min(1).max(5),
  stage: z.enum(['routed', 'in_progress', 'resolved']),
});

export const GenerateEmailBodyOutputSchema = z.object({
  body: z.string().min(1),
});

export type GenerateEmailBodyInput = z.infer<typeof GenerateEmailBodyInputSchema>;
export type GenerateEmailBodyOutput = z.infer<typeof GenerateEmailBodyOutputSchema>;
