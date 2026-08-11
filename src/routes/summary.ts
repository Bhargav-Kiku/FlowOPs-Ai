import { Router, Request, Response } from "express";
import { callGroq, FAST_MODEL } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { asyncRoute } from "../lib/asyncRoute";
import { summarySystemPrompt } from "../prompts/summary";
import { SummaryInputSchema, SummaryOutputSchema } from "../schemas/summary";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  // ── Input validation ───────────────────────────────────────────────────────
  const inputParse = SummaryInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  // ── Groq call (uses smaller/faster model for low latency) ─────────────────
  const { data, usage, model, retried } = await callGroq({
    systemPrompt: summarySystemPrompt,
    userContent: JSON.stringify(inputParse.data.context),
    schema: SummaryOutputSchema,
    model: FAST_MODEL,  // Use fast model for this low-latency endpoint
    endpoint: "summary",
    requestId,
  });

  // ── Response guard + disclaimer injection ──────────────────────────────────
  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "summary",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
