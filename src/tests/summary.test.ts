import "./testSetup";
import request from "supertest";
import { AUTH_HEADER } from "./testSetup";

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
    usage: { prompt_tokens: 60, completion_tokens: 25, total_tokens: 85 },
  };
}

const VALID_INPUT = {
  context: {
    type: "guest_request",
    guest_name: "Jane Smith",
    room: "408",
    request: "Requesting extra pillows and a late checkout",
    submitted_at: "2024-08-01T14:30:00Z",
  },
};

describe("POST /api/v1/summary", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with a summary string", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ summary: "Guest Jane Smith in room 408 has requested extra pillows and a late checkout on August 1st." })
    );

    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(typeof res.body.summary).toBe("string");
    expect(res.body.summary.length).toBeGreaterThan(0);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("uses the fast model for summary (check _meta.model)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ summary: "Test summary." })
    );

    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body._meta.model).toBe(process.env.GROQ_FAST_MODEL ?? "qwen/qwen3.6-27b");
  });

  test("accepts various context shapes (flexible input)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ summary: "Property had 45 requests with 92% SLA compliance." })
    );

    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send({
        context: { type: "daily_report", property: "Grand Hotel", date: "2024-08-01", total_requests: 45 },
      });

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
  });

  test("returns 400 when context is missing", async () => {
    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/v1/summary")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("returns 422 if AI returns empty summary after retry", async () => {
    const badOutput = { summary: "" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ summary: "A summary." })
    );

    const res = await request(app)
      .post("/api/v1/summary")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
