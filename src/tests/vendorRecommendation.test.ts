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
    usage: { prompt_tokens: 70, completion_tokens: 30, total_tokens: 100 },
  };
}

const VALID_INPUT = {
  guest_case_id: "CASE-999",
  task_type: "elevator_maintenance",
  severity: 1,
  property: "Grand Hotel",
  candidates: [
    { index: 0, vendor_id: "VND-001", name: "Acme Lifts", rating: 4.5, sla_response_time_hrs: 4, contract_status: "Active" },
    { index: 1, vendor_id: "VND-002", name: "QuickFix Co", rating: 3.8, sla_response_time_hrs: 2, contract_status: "Preferred" },
    { index: 2, vendor_id: "VND-003", name: "Premier Services", rating: 4.8, sla_response_time_hrs: 6, contract_status: "Emergency Only" },
  ],
};

const VALID_AI_OUTPUT = {
  recommended_index: 1,
  reason: "QuickFix Co has a 2hr SLA suitable for severity 1",
  confidence: 0.88,
};

describe("POST /api/v1/vendor-recommendation", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid recommendation", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.recommended_index).toBe(1);
    expect(res.body.reason).toBeDefined();
    expect(res.body.confidence).toBeGreaterThanOrEqual(0);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("returns 422 when AI returns a vendor_id not in the input list", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_index: 99, reason: "Hallucinated vendor", confidence: 0.9 })
    );

    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 400 for empty vendors array", async () => {
    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send({ guest_case_id: "case", task_type: "plumbing", severity: 2, property: "Hotel", candidates: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send({ property: "Hotel" });

    expect(res.status).toBe(400);
  });

  test("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("returns 422 if AI output is malformed after retry", async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: "still not json" } }], usage: {} });

    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/vendor-recommendation")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
