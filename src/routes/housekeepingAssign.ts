import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { logger } from "../lib/logger";
import { asyncRoute } from "../lib/asyncRoute";
import { housekeepingAssignSystemPrompt } from "../prompts/housekeepingAssign";
import {
  HousekeepingAssignInputSchema,
  HousekeepingAssignOutputSchema,
  HousekeepingAssignOutput,
} from "../schemas/housekeepingAssign";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = HousekeepingAssignInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  const input = inputParse.data;

  // ── Groq call ──────────────────────────────────────────────────────────────
  const { data, usage, model, retried } = await callGroq({
    systemPrompt: housekeepingAssignSystemPrompt,
    userContent: JSON.stringify(input),
    schema: HousekeepingAssignOutputSchema,
    endpoint: "housekeeping-assign",
    requestId,
  });

  // ── Priority logic enforcement (code-level, not just prompt-level) ─────────
  let enforcedData: HousekeepingAssignOutput = data;

  if (data.recommended_staff_id !== null) {
    const pickedCandidate = input.candidates.find(
      (c) => c.staff_id === data.recommended_staff_id
    );

    if (!pickedCandidate) {
      logger.warn(
        { requestId, recommended_staff_id: data.recommended_staff_id },
        "housekeeping-assign: AI recommended a staff_id not in the candidates list — overriding to null"
      );
      enforcedData = {
        recommended_staff_id: null,
        reason: "AI recommendation could not be validated: the recommended staff ID was not in the provided candidates list.",
        confidence: 0,
      };
    } else if (!pickedCandidate.on_shift) {
      logger.warn(
        { requestId, staff_id: data.recommended_staff_id },
        "housekeeping-assign: AI recommended an off-shift staff member — overriding to null"
      );
      enforcedData = {
        recommended_staff_id: null,
        reason: `AI attempted to recommend ${pickedCandidate.name} who is not currently on shift. No on-shift candidate with the required qualifications was available.`,
        confidence: 0,
      };
    } else if (!pickedCandidate.same_property) {
      // Allowed but log a warning — off-property is a degraded recommendation
      logger.warn(
        { requestId, staff_id: data.recommended_staff_id },
        "housekeeping-assign: AI recommended staff from a different property — allowed but flagged"
      );
    }
  }

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    enforcedData as unknown as Record<string, unknown>,
    "housekeeping-assign",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
