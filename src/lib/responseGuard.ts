import { logger } from "./logger";

// ── Forbidden patterns ────────────────────────────────────────────────────────

/**
 * Keys that should never appear in an AI response — they imply database record
 * references or operational actions that this service must never assert.
 */
const FORBIDDEN_KEYS = new Set([
  "sys_id",
  "sysId",
  "sys_created_by",
  "sys_updated_by",
  "sys_created_on",
  "sys_updated_on",
  "table",
  "tableName",
  "record_id",
  "recordId",
]);

/**
 * Regex patterns that indicate the AI is attempting to claim an operational
 * action (e.g. "I have created a work order", "assigned to engineer X").
 */
const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\b(created|inserted|updated|deleted|removed|assigned|dispatched|escalated|closed)\s+(a\s+)?(record|work\s*order|ticket|case|task|incident)\b/i,
  /\bsys_id\s*[:=]\s*[a-f0-9]{32}\b/i,
  /\b[a-f0-9]{32}\b/, // bare sys_id hex string
];

// ── Guard ──────────────────────────────────────────────────────────────────────

/**
 * Recursively scans an AI-produced object for forbidden keys or value patterns,
 * strips them with a warning, and always injects the mandatory disclaimer.
 *
 * This is an architectural safeguard enforced in code — not in the prompt.
 */
export function applyResponseGuard<T extends Record<string, unknown>>(
  data: T,
  endpoint: string,
  requestId: string
): T & { ai_role: "recommendation_only" } {
  const cleaned = stripForbiddenFields(data, endpoint, requestId) as T;
  sanitizeStringValues(cleaned, endpoint, requestId);

  return {
    ...cleaned,
    ai_role: "recommendation_only" as const,
  };
}

function stripForbiddenFields(
  obj: Record<string, unknown>,
  endpoint: string,
  requestId: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      logger.warn(
        { requestId, endpoint, strippedKey: key },
        "responseGuard: stripped forbidden key from AI output"
      );
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? stripForbiddenFields(item as Record<string, unknown>, endpoint, requestId)
          : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = stripForbiddenFields(value as Record<string, unknown>, endpoint, requestId);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function sanitizeStringValues(
  obj: Record<string, unknown>,
  endpoint: string,
  requestId: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
        if (pattern.test(value)) {
          logger.warn(
            { requestId, endpoint, key, pattern: pattern.source },
            "responseGuard: AI string value matched forbidden action pattern — field retained but logged"
          );
        }
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitizeStringValues(value as Record<string, unknown>, endpoint, requestId);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          sanitizeStringValues(item as Record<string, unknown>, endpoint, requestId);
        }
      }
    }
  }
}
