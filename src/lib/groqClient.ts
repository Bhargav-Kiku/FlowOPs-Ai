// groq-sdk ships as CommonJS. We use `import type` for compile-time types only
// and `require()` at runtime so that jest.mock("groq-sdk") intercepts it correctly.
import type GroqType from "groq-sdk";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GroqClass = require("groq-sdk") as typeof GroqType;
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

// ── Groq client singleton ─────────────────────────────────────────────────────

type GroqClient = InstanceType<typeof GroqType>;

let _client: GroqClient | null = null;

function getClient(): GroqClient {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY environment variable is not set");
    _client = new GroqClass({ apiKey });
  }
  return _client;
}

// Allow tests to reset the singleton between test suites
export function _resetClientForTesting(): void {
  _client = null;
}


// ── Model selection ───────────────────────────────────────────────────────────

export const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "allam-2-7b";
export const FAST_MODEL = process.env.GROQ_FAST_MODEL ?? "allam-2-7b";

// ── Correction prompt builder ─────────────────────────────────────────────────

function buildCorrectionPrompt(schema: ZodSchema, validationError: string): string {
  return (
    `Your previous response was not valid JSON or did not match the required schema.\n` +
    `Validation error: ${validationError}\n\n` +
    `Return ONLY a valid JSON object matching this schema (no markdown, no explanation, no code fences):\n` +
    `${JSON.stringify(zodToJsonSchemaHint(schema), null, 2)}`
  );
}

/** Very lightweight schema hint extractor for the correction prompt */
function zodToJsonSchemaHint(schema: ZodSchema): unknown {
  // We extract a description from Zod's internal structure for the correction prompt.
  // This is intentionally simple — its purpose is to guide the model, not to be a full JSON Schema.
  try {
    const desc = schema.description ?? schema._def?.description;
    if (desc) return { description: desc };
  } catch {
    // ignore
  }
  return { note: "See original system prompt for the required JSON shape." };
}

// ── Main callGroq helper ───────────────────────────────────────────────────────

interface CallGroqOptions<T> {
  systemPrompt: string;
  userContent: string;
  schema: ZodSchema<T>;
  model?: string;
  endpoint: string;
  requestId: string;
}

interface CallGroqResult<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  retried: boolean;
}

export async function callGroq<T>(options: CallGroqOptions<T>): Promise<CallGroqResult<T>> {
  const { systemPrompt, userContent, schema, endpoint, requestId } = options;
  const model = options.model ?? DEFAULT_MODEL;
  const client = getClient();

  const startMs = Date.now();
  let _retried = false;
  let lastError = "";

  // ── First attempt ────────────────────────────────────────────────────────────
  let rawContent: string;
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const fetchWithRetries = async (messages: any[], temperature: number) => {
    const maxRetries = 4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await Promise.race([
          client.chat.completions.create({
            model,
            messages,
            response_format: { type: "json_object" },
            temperature,
            max_tokens: 1024,
          }),
          timeoutPromise(10_000),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if ((message.includes("429") || message.includes("503") || message.includes("rate limit") || message.includes("rate_limit")) && attempt < maxRetries) {
          
          let delayMs = 1000 * Math.pow(2, attempt); // default exponential backoff
          const match = message.match(/Please try again in ([\d.]+)(m?s)/);
          if (match) {
            const amount = parseFloat(match[1]);
            delayMs = match[2] === "s" ? amount * 1000 : amount;
          }
          // Add jitter to prevent thundering herd
          delayMs += Math.random() * 500 + 100;
          
          logger.warn({ requestId, endpoint, model, attempt: attempt + 1, delayMs: Math.round(delayMs) }, "Rate limited, retrying AI call...");
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max API retries exceeded");
  };

  try {
    const completion = await fetchWithRetries(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      0.2
    );

    rawContent = completion.choices[0]?.message?.content ?? "";
    usage = {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ requestId, endpoint, model, err: message }, "Groq API call failed");
    throw new AIUnavailableError(`Groq API call failed: ${message}`);
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

  // ── Retry attempt ─────────────────────────────────────────────────────────────
  const correctionContent = buildCorrectionPrompt(schema, lastError);

  try {
    const retryCompletion = await fetchWithRetries(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
        { role: "assistant", content: rawContent },
        { role: "user", content: correctionContent },
      ],
      0.1
    );

    const retryContent = retryCompletion.choices[0]?.message?.content ?? "";
    const retryUsage = {
      promptTokens: (retryCompletion.usage?.prompt_tokens ?? 0) + usage.promptTokens,
      completionTokens: (retryCompletion.usage?.completion_tokens ?? 0) + usage.completionTokens,
      totalTokens: (retryCompletion.usage?.total_tokens ?? 0) + usage.totalTokens,
    };

    const retryResult = tryParseAndValidate<T>(retryContent, schema);
    const latencyMs = Date.now() - startMs;
    logAICall({ requestId, endpoint, model, latencyMs, ...retryUsage, retried: true });

    if (retryResult.success) {
      return { data: retryResult.data, usage: retryUsage, model, retried: true };
    }

    logger.error({ requestId, endpoint, model, retryError: retryResult.error }, "AI output failed validation after retry");
    throw new InvalidAIOutputError(`AI output invalid after retry: ${retryResult.error}`);
  } catch (err) {
    if (err instanceof InvalidAIOutputError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AIUnavailableError(`Groq retry call failed: ${message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function tryParseAndValidate<T>(raw: string, schema: ZodSchema<T>): ParseResult<T> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
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
    setTimeout(() => reject(new Error(`Groq API call timed out after ${ms}ms`)), ms)
  );
}
