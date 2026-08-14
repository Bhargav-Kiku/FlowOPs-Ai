import { z } from "zod";

export const EngineeringTriageInputSchema = z.object({
  guest_case_id: z.string().min(1),
  service_subtype: z.string().min(1),
  priority: z.number().int(),
  description: z.string().min(1),
  room: z.string().min(1),
  property: z.string().min(1),
  assets: z.array(
    z.object({
      asset_name: z.string(),
      asset_type: z.string(),
      status: z.string(),
      criticality: z.string(),
    })
  ).optional(),
});

export const EngineeringTriageOutputSchema = z.object({
  problem_category: z.string().min(1),
  recommended_action: z.string().min(1),
  routing_decision: z.enum(["internal_only", "vendor_direct", "hybrid"]),
  suggested_priority: z.number().int(),
  confidence: z.number().min(0).max(1),
});

export type EngineeringTriageInput = z.infer<typeof EngineeringTriageInputSchema>;
export type EngineeringTriageOutput = z.infer<typeof EngineeringTriageOutputSchema>;
