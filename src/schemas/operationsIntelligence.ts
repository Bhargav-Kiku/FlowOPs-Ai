import { z } from "zod";

export const OperationsIntelligenceInputSchema = z.object({
  property: z.string().min(1),
  period: z.string().min(1),
  metrics: z.record(z.unknown()),
});

export const IssueSchema = z.object({
  category: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  finding: z.string().min(1),
});

export const OperationsIntelligenceOutputSchema = z.object({
  health_score: z.number().min(0).max(100),
  issues: z.array(IssueSchema),
  recommendations: z.array(z.string().min(1)),
});

export type OperationsIntelligenceInput = z.infer<typeof OperationsIntelligenceInputSchema>;
export type OperationsIntelligenceOutput = z.infer<typeof OperationsIntelligenceOutputSchema>;
