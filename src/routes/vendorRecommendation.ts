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

  // ── Validate that recommended vendor_id is from the input list ─────────────
  const validVendorIds = new Set(input.vendors.map((v) => v.vendor_id));
  if (!validVendorIds.has(data.recommended_vendor_id)) {
    logger.warn(
      { requestId, recommended_vendor_id: data.recommended_vendor_id },
      "vendor-recommendation: AI returned a vendor_id not in the input list"
    );
    res.status(422).json({
      error: "invalid_ai_output",
      detail: "AI returned a vendor_id that was not in the provided vendors list",
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
