import { z } from "zod";

export const VendorSchema = z.object({
  vendor_id: z.string().min(1),
  name: z.string().min(1),
  rating: z.number().min(0).max(5),
  sla_percentage: z.number().min(0).max(100),
  avg_response_time_hours: z.number().min(0),
  cost_index: z.number().min(0),
});

export const VendorRecommendationInputSchema = z.object({
  service_category: z.string().min(1),
  property: z.string().min(1),
  vendors: z.array(VendorSchema).min(1, "At least one vendor is required"),
});

export const VendorRecommendationOutputSchema = z.object({
  recommended_vendor_id: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Vendor = z.infer<typeof VendorSchema>;
export type VendorRecommendationInput = z.infer<typeof VendorRecommendationInputSchema>;
export type VendorRecommendationOutput = z.infer<typeof VendorRecommendationOutputSchema>;
