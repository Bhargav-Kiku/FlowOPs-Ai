import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { asyncRoute } from "../lib/asyncRoute";
import { buildIntentClassificationSystemPrompt } from "../prompts/intentClassification";
import {
  IntentClassificationInputSchema,
  IntentClassificationOutputSchema,
} from "../schemas/intentClassification";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = IntentClassificationInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  const { request, property, room, departments } = inputParse.data;

  const userContent = JSON.stringify({ request, property, room });
  const systemPrompt = buildIntentClassificationSystemPrompt(departments);

  // ── Groq call ──────────────────────────────────────────────────────────────
  const { data, usage, model, retried } = await callGroq({
    systemPrompt,
    userContent,
    schema: IntentClassificationOutputSchema,
    endpoint: "intent-classification",
    requestId,
  });

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "intent-classification",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: {
      model,
      retried,
      usage,
      requestId,
    },
  });
}));

export default router;
