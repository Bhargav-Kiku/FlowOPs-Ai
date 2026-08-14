import { z } from "zod";

export const VendorSchema = z.object({
  index: z.number().int(),
  vendor_id: z.string().min(1),
  name: z.string().min(1),
  rating: z.number().min(0).max(5),
  sla_response_time_hrs: z.number().min(0),
  contract_status: z.string().min(1),
});

export const VendorRecommendationInputSchema = z.object({
  guest_case_id: z.string().min(1),
  task_type: z.string().min(1),
  severity: z.number().int(),
  property: z.string().min(1),
  candidates: z.array(VendorSchema).min(1, "At least one vendor candidate is required"),
});

export const VendorRecommendationOutputSchema = z.object({
  recommended_index: z.number().int(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Vendor = z.infer<typeof VendorSchema>;
export type VendorRecommendationInput = z.infer<typeof VendorRecommendationInputSchema>;
export type VendorRecommendationOutput = z.infer<typeof VendorRecommendationOutputSchema>;
