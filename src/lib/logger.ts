import pino from "pino";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";

// ── Logger instance ────────────────────────────────────────────────────────────

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
  base: { service: "flowops-ai-backend" },
});

// ── HTTP request logger middleware ─────────────────────────────────────────────

export const httpLogger = pinoHttp({
  logger,
  genReqId: () => uuidv4(),
  customLogLevel: (_req, res) => {
    if (res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});

// ── Structured AI-call logger ──────────────────────────────────────────────────

export interface AICallLog {
  requestId: string;
  endpoint: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  confidence?: number;
  retried?: boolean;
}

export function logAICall(entry: AICallLog): void {
  logger.info(
    {
      type: "ai_call",
      ...entry,
    },
    "AI call completed"
  );
}
