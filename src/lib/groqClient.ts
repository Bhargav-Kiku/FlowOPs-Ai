/**
 * groqClient.ts (Compatibility Layer)
 * Re-exports the Gemini client implementations so existing routes and tests
 * remain functional while each endpoint is progressively migrated to Gemini.
 */
export {
  callGemini as callGroq,
  InvalidAIOutputError,
  AIUnavailableError,
  DEFAULT_MODEL,
  FAST_MODEL,
  _resetClientForTesting,
} from "./geminiClient";
