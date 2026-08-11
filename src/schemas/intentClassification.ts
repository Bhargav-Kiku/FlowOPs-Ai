import { z } from "zod";

export const IntentClassificationInputSchema = z.object({
  request: z.string().min(1, "request is required"),
  property: z.string().min(1, "property is required"),
  room: z.string().min(1, "room is required"),
});

export const VALID_INTENTS = ["engineering", "housekeeping", "vendor", "guest_services", "other"] as const;

export const IntentClassificationOutputSchema = z.object({
  intents: z
    .array(
      z.object({
        intent: z.enum(VALID_INTENTS),
        confidence: z.number().min(0).max(1),
      })
    )
    .min(1),
  urgency: z.enum(["low", "medium", "high"]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string().min(1),
});

export type IntentClassificationInput = z.infer<typeof IntentClassificationInputSchema>;
export type IntentClassificationOutput = z.infer<typeof IntentClassificationOutputSchema>;
