import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { asyncRoute } from "../lib/asyncRoute";
import { operationsIntelligenceSystemPrompt } from "../prompts/operationsIntelligence";
import {
  OperationsIntelligenceInputSchema,
  OperationsIntelligenceOutputSchema,
} from "../schemas/operationsIntelligence";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = OperationsIntelligenceInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  // ── Groq call ──────────────────────────────────────────────────────────────
  const { data, usage, model, retried } = await callGroq({
    systemPrompt: operationsIntelligenceSystemPrompt,
    userContent: JSON.stringify(inputParse.data),
    schema: OperationsIntelligenceOutputSchema,
    endpoint: "operations-intelligence",
    requestId,
  });

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "operations-intelligence",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
