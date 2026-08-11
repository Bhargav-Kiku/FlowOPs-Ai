import "./testSetup";
import request from "supertest";
import { AUTH_HEADER } from "./testSetup";

// groq-sdk is CommonJS — mock returns the constructor directly (no .default wrapper)
const mockCreate = jest.fn();
jest.mock("groq-sdk", () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }))
);

import app from "../server";
import { _resetClientForTesting } from "../lib/groqClient";

function mockGroqResponse(content: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

const VALID_INPUT = {
  request: "The AC is broken and I need fresh towels",
  property: "Grand Hotel",
  room: "402",
};

const VALID_AI_OUTPUT = {
  intents: [
    { intent: "engineering", confidence: 0.95 },
    { intent: "housekeeping", confidence: 0.9 },
  ],
  urgency: "high",
  sentiment: "negative",
  summary: "Guest reports a broken AC unit and requests fresh towels in room 402.",
};

describe("POST /api/v1/intent-classification", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid output for valid input", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.intents).toHaveLength(2);
    expect(res.body.urgency).toBe("high");
    expect(res.body.sentiment).toBe("negative");
    expect(res.body.summary).toBeDefined();
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("strips sys_id if AI includes it", async () => {
    const outputWithSysId = { ...VALID_AI_OUTPUT, sys_id: "abc123def456abc123def456abc123de" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(outputWithSysId));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.sys_id).toBeUndefined();
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("returns 400 for invalid input (missing required fields)", async () => {
    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "broken AC" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 401 when API key is missing", async () => {
    const res = await request(app)
      .post("/api/v1/intent-classification")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  test("returns 401 when API key is wrong", async () => {
    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set("x-flowops-api-key", "wrong-key")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("retries and returns 422 if AI output is invalid JSON after both attempts", async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: "not json at all" } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: "still not json" } }], usage: {} });

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 if AI output has invalid schema after retry", async () => {
    const badOutput = { intents: "not-an-array", urgency: "high" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("succeeds on retry if first AI response is invalid but second is valid", async () => {
    const badOutput = { intents: "not-an-array" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body._meta.retried).toBe(true);
  });

  test("returns 502 when Groq API call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Groq API call timed out after 10000ms"));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ai_unavailable");
  });
});
