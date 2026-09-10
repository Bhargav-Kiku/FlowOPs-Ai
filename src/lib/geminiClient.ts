import { GoogleGenerativeAI } from "@google/generative-ai";
import { ZodSchema } from "zod";
import { logger, logAICall } from "./logger";

// ── Custom errors ─────────────────────────────────────────────────────────────

export class InvalidAIOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAIOutputError";
  }
}

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUnavailableError";
  }
}

// ── Model selection ───────────────────────────────────────────────────────────

export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? "gemini-3.6-flash";

// ── Multi-Key Client Pool with Failover ────────────────────────────────────────

interface KeyEntry {
  key: string;
  client: GoogleGenerativeAI;
  cooldownUntil: number;
}

let _keyPool: KeyEntry[] | null = null;
let _nextKeyIndex = 0;

function getKeyPool(): KeyEntry[] {
  if (_keyPool && _keyPool.length > 0) {
    return _keyPool;
  }

  const rawKeys = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY;
  if (!rawKeys) {
    throw new Error("Neither GEMINI_API_KEYS nor GEMINI_API_KEY environment variable is set");
  }

  const keys = rawKeys
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keys.length === 0) {
    throw new Error("No valid Gemini API keys found in environment variables");
  }

  _keyPool = keys.map((key) => ({
    key,
    client: new GoogleGenerativeAI(key),
    cooldownUntil: 0,
  }));
  _nextKeyIndex = 0;

  return _keyPool;
}

/** Reset the singleton pool for tests */
export function _resetClientForTesting(): void {
  _keyPool = null;
  _nextKeyIndex = 0;
}

function getAvailableClientEntry(): KeyEntry {
  const pool = getKeyPool();
  const now = Date.now();

  // Try round-robin search starting from _nextKeyIndex
  for (let i = 0; i < pool.length; i++) {
    const idx = (_nextKeyIndex + i) % pool.length;
    const entry = pool[idx];
    if (entry.cooldownUntil <= now) {
      _nextKeyIndex = (idx + 1) % pool.length;
      return entry;
    }
  }

  // If all keys are currently in cooldown, return the one that expires soonest
  let earliest = pool[0];
  for (const entry of pool) {
    if (entry.cooldownUntil < earliest.cooldownUntil) {
      earliest = entry;
    }
  }
  return earliest;
}

function markKeyCooldown(entry: KeyEntry, delayMs = 60_000): void {
  entry.cooldownUntil = Date.now() + delayMs;
  const maskedKey = entry.key.length > 8 ? `${entry.key.slice(0, 4)}...${entry.key.slice(-4)}` : "***";
  logger.warn({ key: maskedKey, cooldownMs: delayMs }, "Gemini API key marked in temporary cooldown");
}

function isRateLimitOrTemporaryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("503") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("high demand") ||
    lower.includes("service unavailable")
  );
}

// ── Correction prompt builder ─────────────────────────────────────────────────

function buildCorrectionPrompt(schema: ZodSchema, validationError: string): string {
  return (
    `Your previous response was not valid JSON or did not match the required schema.\n` +
    `Validation error: ${validationError}\n\n` +
    `Return ONLY a valid JSON object matching this schema (no markdown, no explanation, no code fences):\n` +
    `${JSON.stringify(zodToJsonSchemaHint(schema), null, 2)}`
  );
}

function zodToJsonSchemaHint(schema: ZodSchema): unknown {
  try {
    const desc = schema.description ?? (schema as any)._def?.description;
    if (desc) return { description: desc };
  } catch {
    // ignore
  }
  return { note: "See original system prompt for the required JSON shape." };
}

// ── Call Gemini Helper ─────────────────────────────────────────────────────────

export interface CallGeminiOptions<T> {
  systemPrompt: string;
  userContent: string;
  schema: ZodSchema<T>;
  model?: string;
  endpoint: string;
  requestId: string;
}

export interface CallGeminiResult<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  retried: boolean;
}

export async function callGemini<T>(options: CallGeminiOptions<T>): Promise<CallGeminiResult<T>> {
  const { systemPrompt, userContent, schema, endpoint, requestId } = options;
  const model = options.model ?? DEFAULT_MODEL;

  const startMs = Date.now();
  let _retried = false;
  let lastError = "";

  // ── First attempt with key rotation and retries ──────────────────────────────
  let rawContent = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const executeWithRetry = async (
    runOnModel: (modelInstance: any) => Promise<any>,
    temperature: number
  ) => {
    const pool = getKeyPool();
    const maxRetries = Math.max(pool.length, 3);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const keyEntry = getAvailableClientEntry();
      const modelInstance = keyEntry.client.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: "application/json",
          temperature,
          maxOutputTokens: 1024,
        },
      });

      try {
        const result = await Promise.race([
          runOnModel(modelInstance),
          timeoutPromise(30_000),
        ]);
        return result;
      } catch (err) {
        if (isRateLimitOrTemporaryError(err) && attempt < maxRetries) {
          // If we have other keys in pool, put this key in cooldown and try next key immediately
          markKeyCooldown(keyEntry);

          const activeCount = pool.filter((k) => k.cooldownUntil <= Date.now()).length;
          let delayMs = 0;
          if (activeCount === 0) {
            // All keys in cooldown, use exponential backoff
            delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500 + 100;
            logger.warn(
              { requestId, endpoint, model, attempt: attempt + 1, delayMs: Math.round(delayMs) },
              "All Gemini keys in cooldown/rate limited, backing off..."
            );
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            logger.warn(
              { requestId, endpoint, model, attempt: attempt + 1, remainingActiveKeys: activeCount },
              "Gemini key rate-limited; failing over to next key in pool immediately."
            );
          }
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max Gemini API retries exceeded across key pool");
  };

  try {
    const result = await executeWithRetry(
      (m) => m.generateContent(userContent),
      0.2
    );

    const response = await result?.response;
    rawContent =
      typeof response?.text === "function"
        ? response.text()
        : typeof result?.response?.text === "string"
        ? result.response.text
        : result?.choices?.[0]?.message?.content ?? "";

    const meta = response?.usageMetadata ?? result?.usage;
    usage = {
      promptTokens: meta?.promptTokenCount ?? meta?.prompt_tokens ?? 0,
      completionTokens: meta?.candidatesTokenCount ?? meta?.completion_tokens ?? 0,
      totalTokens: meta?.totalTokenCount ?? meta?.total_tokens ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ requestId, endpoint, model, err: message }, "Gemini API call failed");
    throw new AIUnavailableError(`Gemini API call failed: ${message}`);
  }

  // ── Parse + validate (attempt 1) ─────────────────────────────────────────────
  const firstResult = tryParseAndValidate<T>(rawContent, schema);
  if (firstResult.success) {
    const latencyMs = Date.now() - startMs;
    logAICall({ requestId, endpoint, model, latencyMs, ...usage, retried: false });
    return { data: firstResult.data, usage, model, retried: _retried };
  }

  lastError = firstResult.error;
  _retried = true;
  logger.warn({ requestId, endpoint, model, parseError: lastError }, "AI output failed validation — retrying with correction prompt");

  // ── Retry attempt with correction prompt ──────────────────────────────────────
  const correctionContent = buildCorrectionPrompt(schema, lastError);

  try {
    const retryResultCall = await executeWithRetry(
      (m) =>
        m.generateContent({
          contents: [
            { role: "user", parts: [{ text: userContent }] },
            { role: "model", parts: [{ text: rawContent }] },
            { role: "user", parts: [{ text: correctionContent }] },
          ],
        }),
      0.1
    );

    const retryResponse = await retryResultCall?.response;
    const retryContent =
      typeof retryResponse?.text === "function"
        ? retryResponse.text()
        : typeof retryResultCall?.response?.text === "string"
        ? retryResultCall.response.text
        : retryResultCall?.choices?.[0]?.message?.content ?? "";

    const retryMeta = retryResponse?.usageMetadata ?? retryResultCall?.usage;
    const retryUsage = {
      promptTokens: (retryMeta?.promptTokenCount ?? retryMeta?.prompt_tokens ?? 0) + usage.promptTokens,
      completionTokens: (retryMeta?.candidatesTokenCount ?? retryMeta?.completion_tokens ?? 0) + usage.completionTokens,
      totalTokens: (retryMeta?.totalTokenCount ?? retryMeta?.total_tokens ?? 0) + usage.totalTokens,
    };

    const retryValidation = tryParseAndValidate<T>(retryContent, schema);
    const latencyMs = Date.now() - startMs;
    logAICall({ requestId, endpoint, model, latencyMs, ...retryUsage, retried: true });

    if (retryValidation.success) {
      return { data: retryValidation.data, usage: retryUsage, model, retried: true };
    }

    logger.error({ requestId, endpoint, model, retryError: retryValidation.error }, "AI output failed validation after retry");
    throw new InvalidAIOutputError(`AI output invalid after retry: ${retryValidation.error}`);
  } catch (err) {
    if (err instanceof InvalidAIOutputError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AIUnavailableError(`Gemini retry call failed: ${message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function tryParseAndValidate<T>(raw: string, schema: ZodSchema<T>): ParseResult<T> {
  let parsed: unknown;

  try {
    const cleanRaw = raw
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
    const start = cleanRaw.indexOf("{");
    const end = cleanRaw.lastIndexOf("}");
    const extracted = start !== -1 && end !== -1 && end >= start ? cleanRaw.substring(start, end + 1) : cleanRaw;
    parsed = JSON.parse(extracted);
  } catch (err) {
    return { success: false, error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
  };
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini API call timed out after ${ms}ms`)), ms)
  );
}
