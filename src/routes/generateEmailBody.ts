import { Router, Request, Response } from "express";
import { callGroq } from "../lib/groqClient";
import { applyResponseGuard } from "../lib/responseGuard";
import { asyncRoute } from "../lib/asyncRoute";
import { buildEmailBodySystemPrompt } from "../prompts/generateEmailBody";
import {
  GenerateEmailBodyInputSchema,
  GenerateEmailBodyOutputSchema,
} from "../schemas/generateEmailBody";

const router = Router();

router.post("/", asyncRoute(async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  const inputParse = GenerateEmailBodyInputSchema.safeParse(req.body);
  if (!inputParse.success) {
    res.status(400).json({
      error: "invalid_input",
      detail: inputParse.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  const input = inputParse.data;

  const { data, usage, model, retried } = await callGroq({
    systemPrompt: buildEmailBodySystemPrompt(input.stage, input.sentiment),
    userContent: JSON.stringify({ request_text: input.request_text }),
    schema: GenerateEmailBodyOutputSchema,
    endpoint: "generate-email-body",
    requestId,
  });

  const guarded = applyResponseGuard(
    data as Record<string, unknown>,
    "generate-email-body",
    requestId
  );

  res.status(200).json({
    ...guarded,
    _meta: { model, retried, usage, requestId },
  });
}));

export default router;
