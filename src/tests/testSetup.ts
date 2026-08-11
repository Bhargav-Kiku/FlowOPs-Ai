/**
 * Test helper — sets up the Express app with required env vars and
 * provides utilities for mocking Groq responses.
 */
import "dotenv/config";

// Ensure required env vars are set before app loads
process.env.FLOWOPS_API_KEY = "test-api-key-12345";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

export const TEST_API_KEY = "test-api-key-12345";

export const AUTH_HEADER = { "x-flowops-api-key": TEST_API_KEY };
