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
  service_subtype: "hvac",
  priority: 1,
  description: "AC is completely broken and leaking water",
  room: "510",
  property: "Grand Hotel",
  assets: [
    { asset_name: "AC Unit 1", asset_type: "HVAC", status: "active", criticality: "high" }
  ]
};

const VALID_AI_OUTPUT = {
  problem_category: "HVAC Failure",
  recommended_action: "Inspect wiring and replace switch",
  routing_decision: "vendor_direct",
  confidence: 0.82,
  suggested_priority: 2,
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
    expect(["internal_only", "vendor_direct", "hybrid"]).toContain(res.body.routing_decision);
    expect(typeof res.body.recommended_action).toBe("string");
    expect([1, 2, 3, 4]).toContain(res.body.suggested_priority);
    expect(res.body.confidence).toBeGreaterThanOrEqual(0);
    expect(res.body.confidence).toBeLessThanOrEqual(1);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("works with minimal input (only required fields)", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send({ guest_case_id: "CASE-003", service_subtype: "plumbing", priority: 2, description: "broken pipe", room: "201", property: "Grand Hotel" });

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

  test("returns 422 if AI returns invalid routing_decision enum after retry", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, routing_decision: "unknown_route" };
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
