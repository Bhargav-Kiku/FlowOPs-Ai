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
    usage: { prompt_tokens: 90, completion_tokens: 45, total_tokens: 135 },
  };
}

const VALID_INPUT = {
  guest_case_id: "CASE-002",
  room: "510",
  asset: { type: "HVAC", model: "Carrier-2020", last_maintenance: "2024-01-15" },
  asset_history: [{ event: "filter_replaced", date: "2024-01-15" }],
  previous_work_orders: [{ issue: "refrigerant_leak", resolved: true, date: "2023-06-10" }],
  criticality: "high",
  warranty_status: "expired",
};

const VALID_AI_OUTPUT = {
  problem_category: "HVAC Failure",
  severity: "high",
  recommended_action: "inspect",
  confidence: 0.82,
  suggested_priority: "high",
};

describe("POST /api/v1/engineering-triage", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid triage for valid input", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.problem_category).toBeDefined();
    expect(["low", "medium", "high", "critical"]).toContain(res.body.severity);
    expect(["repair", "replace", "inspect"]).toContain(res.body.recommended_action);
    expect(res.body.confidence).toBeGreaterThanOrEqual(0);
    expect(res.body.confidence).toBeLessThanOrEqual(1);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("works with minimal input (only required fields)", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send({ guest_case_id: "CASE-003", room: "201" });

    expect(res.status).toBe(200);
  });

  test("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send({ room: "510" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("returns 422 if AI returns invalid severity enum after retry", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, severity: "catastrophic" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("strips sys_id from AI output", async () => {
    const outputWithSysId = { ...VALID_AI_OUTPUT, sys_id: "aaaaabbbbccccdddd0000111122223333" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(outputWithSysId));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.sys_id).toBeUndefined();
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
