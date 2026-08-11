import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { httpLogger, logger } from "./lib/logger";
import { authMiddleware } from "./lib/auth";
import { InvalidAIOutputError, AIUnavailableError } from "./lib/groqClient";
import { ZodError } from "zod";

// ── Route imports ──────────────────────────────────────────────────────────────
import intentClassificationRouter from "./routes/intentClassification";
import housekeepingAssignRouter from "./routes/housekeepingAssign";
import engineeringTriageRouter from "./routes/engineeringTriage";
import vendorRecommendationRouter from "./routes/vendorRecommendation";
import operationsIntelligenceRouter from "./routes/operationsIntelligence";
import summaryRouter from "./routes/summary";

// ── App setup ──────────────────────────────────────────────────────────────────

const app = express();

// ── Security: no CORS (server-to-server only) ──────────────────────────────────
// Explicitly reject requests with an Origin header (browser requests)
app.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.headers.origin) {
    res.status(403).json({
      error: "forbidden",
      detail: "This API is for server-to-server use only. Browser requests are not permitted.",
    });
    return;
  }
  next();
});

// ── Structured HTTP logging ────────────────────────────────────────────────────
app.use(httpLogger);

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Key by API key header so rate limits are per-consumer not per IP
    const apiKey = req.headers["x-flowops-api-key"];
    return typeof apiKey === "string" ? apiKey : req.ip ?? "unknown";
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: "rate_limit_exceeded",
      detail: "Too many requests. Please slow down.",
    });
  },
});

app.use("/api/v1", limiter);

// ── Authentication (applied to all /api/v1/* routes) ──────────────────────────
app.use("/api/v1", authMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/api/v1/intent-classification", intentClassificationRouter);
app.use("/api/v1/housekeeping-assign", housekeepingAssignRouter);
app.use("/api/v1/engineering-triage", engineeringTriageRouter);
app.use("/api/v1/vendor-recommendation", vendorRecommendationRouter);
app.use("/api/v1/operations-intelligence", operationsIntelligenceRouter);
app.use("/api/v1/summary", summaryRouter);

// ── Health check (no auth required) ───────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "flowops-ai-backend",
    timestamp: new Date().toISOString(),
  });
});

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found", detail: "Endpoint does not exist" });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const requestId = (req as Request & { id?: string }).id ?? "unknown";

  if (err instanceof InvalidAIOutputError) {
    logger.warn({ requestId, err: err.message }, "Invalid AI output");
    res.status(422).json({
      error: "invalid_ai_output",
      detail: err.message,
    });
    return;
  }

  if (err instanceof AIUnavailableError) {
    logger.error({ requestId, err: err.message }, "AI unavailable");
    res.status(502).json({
      error: "ai_unavailable",
      detail: err.message,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "invalid_input",
      detail: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
    return;
  }

  // Unhandled error
  const message = err instanceof Error ? err.message : "An unexpected error occurred";
  logger.error({ requestId, err: message }, "Unhandled server error");
  res.status(500).json({ error: "internal_server_error", detail: message });
});

export default app;

// ── Start server (only when run directly, not when imported by tests) ──────────
if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, "FlowOps AI Backend started");
  });
}
