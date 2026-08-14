import { z } from "zod";

export const IntentClassificationInputSchema = z.object({
  request: z.string().min(1, "request is required"),
  property: z.string().min(1, "property is required"),
  room: z.string().min(1, "room is required"),
  departments: z.array(
    z.object({
      department: z.string().min(1),
      skills: z.array(
        z.object({
          name: z.string().min(1),
          description: z.string().min(1),
        })
      ).min(1, "skills must contain at least one skill"),
    })
  ).min(1, "departments must contain at least one department"),
});

/**
 * Urgency levels — "critical" is added for life-safety / total habitability failure.
 */
export const URGENCY_LEVELS = ["low", "medium", "high", "critical"] as const;

/**
 * Sentiment codes (numeric):
 *  1 = Urgent & Distressed
 *  2 = Sarcastic
 *  3 = Aggressive
 *  4 = Frustrated
 *  5 = Neutral
 */
export const SENTIMENT_CODES = [1, 2, 3, 4, 5] as const;

/**
 * Priority codes (numeric):
 *  1 = Critical   (immediate safety / habitability risk)
 *  2 = High       (major disruption to guest experience)
 *  3 = Medium     (noticeable inconvenience)
 *  4 = Low        (minor / non-urgent preference)
 */
export const PRIORITY_CODES = [1, 2, 3, 4] as const;

export const IntentClassificationOutputSchema = z.object({
  intents: z
    .array(
      z.object({
        intent: z.string().min(1),
        confidence: z.number().min(0).max(1),
        service_subtype: z.string().min(1),
        case_detail: z.string().min(1),
      })
    )
    .min(1),
  urgency: z.enum(URGENCY_LEVELS),
  sentiment: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  priority: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  summary: z.string().min(1),
});

export type IntentClassificationInput = z.infer<typeof IntentClassificationInputSchema>;
export type IntentClassificationOutput = z.infer<typeof IntentClassificationOutputSchema>;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];
export type SentimentCode = (typeof SENTIMENT_CODES)[number];
export type PriorityCode = (typeof PRIORITY_CODES)[number];
