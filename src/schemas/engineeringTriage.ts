import { z } from "zod";

export const EngineeringTriageInputSchema = z.object({
  guest_case_id: z.string().min(1),
  room: z.string().min(1),
  asset: z.record(z.unknown()).optional(),
  asset_history: z.array(z.unknown()).optional(),
  previous_work_orders: z.array(z.unknown()).optional(),
  criticality: z.string().optional(),
  warranty_status: z.string().optional(),
});

export const EngineeringTriageOutputSchema = z.object({
  problem_category: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  recommended_action: z.enum(["repair", "replace", "inspect"]),
  confidence: z.number().min(0).max(1),
  suggested_priority: z.enum(["low", "medium", "high"]),
});

export type EngineeringTriageInput = z.infer<typeof EngineeringTriageInputSchema>;
export type EngineeringTriageOutput = z.infer<typeof EngineeringTriageOutputSchema>;
