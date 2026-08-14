import { z } from "zod";

export const StaffCandidateSchema = z.object({
  index: z.number().int(),
  staff_id: z.string().min(1),
  name: z.string().min(1),
  on_shift: z.boolean(),
  same_property: z.boolean(),
  has_required_skill: z.boolean(),
  current_room_count: z.number().int().min(0),
});

export const HousekeepingAssignInputSchema = z.object({
  domain: z.string().optional(),
  guest_case_id: z.string().min(1),
  room: z.string().min(1),
  property: z.string().min(1),
  task_type: z.string().min(1),
  severity: z.number().int(),
  candidates: z.array(StaffCandidateSchema).min(1, "At least one candidate is required"),
});

export const HousekeepingAssignOutputSchema = z.object({
  recommended_index: z.number().int(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type StaffCandidate = z.infer<typeof StaffCandidateSchema>;
export type HousekeepingAssignInput = z.infer<typeof HousekeepingAssignInputSchema>;
export type HousekeepingAssignOutput = z.infer<typeof HousekeepingAssignOutputSchema>;
