import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { logger } from "../lib/logger";
import { asyncRoute } from "../lib/asyncRoute";
import { vendorRecommendationSystemPrompt } from "../prompts/vendorRecommendation";
import {
  VendorRecommendationInputSchema,
  VendorRecommendationOutputSchema,
} from "../schemas/vendorRecommendation";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = VendorRecommendationInputSchema.safeParse(req.body);
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
    systemPrompt: vendorRecommendationSystemPrompt,
    userContent: JSON.stringify(input),
    schema: VendorRecommendationOutputSchema,
    endpoint: "vendor-recommendation",
    requestId,
  });

  // ── Validate that recommended_index is from the input list ─────────────
  const validIndices = new Set(input.candidates.map((c) => c.index));
  if (!validIndices.has(data.recommended_index)) {
    logger.warn(
      { requestId, recommended_index: data.recommended_index },
      "vendor-recommendation: AI returned an index not in the candidates list"
    );
    res.status(422).json({
      error: "invalid_ai_output",
      detail: "AI returned an index that was not in the provided candidates list",
    });
    return;
  }

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "vendor-recommendation",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
