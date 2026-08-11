import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { asyncRoute } from "../lib/asyncRoute";
import { engineeringTriageSystemPrompt } from "../prompts/engineeringTriage";
import {
  EngineeringTriageInputSchema,
  EngineeringTriageOutputSchema,
} from "../schemas/engineeringTriage";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = EngineeringTriageInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  // ── Groq call ──────────────────────────────────────────────────────────────
  const { data, usage, model, retried } = await callGroq({
    systemPrompt: engineeringTriageSystemPrompt,
    userContent: JSON.stringify(inputParse.data),
    schema: EngineeringTriageOutputSchema,
    endpoint: "engineering-triage",
    requestId,
  });

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "engineering-triage",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
