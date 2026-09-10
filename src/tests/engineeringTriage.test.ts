import "./testSetup";
import request from "supertest";
import { AUTH_HEADER } from "./testSetup";

const mockGenerateContent = jest.fn();
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import app from "../server";
import { _resetClientForTesting } from "../lib/geminiClient";

function mockGeminiResponse(content: unknown) {
  return {
    response: {
      text: () => (typeof content === "string" ? content : JSON.stringify(content)),
      usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 45, totalTokenCount: 135 },
    },
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
    mockGenerateContent.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid triage for valid input", async () => {
    mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(VALID_AI_OUTPUT));

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
    mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(VALID_AI_OUTPUT));

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
    mockGenerateContent
      .mockResolvedValueOnce(mockGeminiResponse(badOutput))
      .mockResolvedValueOnce(mockGeminiResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("strips sys_id from AI output", async () => {
    const outputWithSysId = { ...VALID_AI_OUTPUT, sys_id: "aaaaabbbbccccdddd0000111122223333" };
    mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(outputWithSysId));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.sys_id).toBeUndefined();
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/engineering-triage")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
