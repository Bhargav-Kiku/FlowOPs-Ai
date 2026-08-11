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
    usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 },
  };
}

const VALID_INPUT = {
  property: "Grand Hotel",
  period: "2024-Q3",
  metrics: {
    guest_requests: 450,
    sla_breach_percentage: 8.5,
    engineering_backlog: 12,
    guest_satisfaction: 8.2,
    vendor_rating: 4.1,
    avg_resolution_time_hours: 3.2,
    staff_utilization_percentage: 78,
    occupancy_percentage: 85,
  },
};

const VALID_AI_OUTPUT = {
  health_score: 74,
  issues: [
    { category: "Engineering", severity: "medium", finding: "Engineering backlog of 12 items is approaching the 20-item threshold" },
  ],
  recommendations: [
    "Schedule additional engineering shifts to reduce backlog below 10 items",
    "Review vendor SLA agreements for Q4 renewal negotiations",
  ],
};

describe("POST /api/v1/operations-intelligence", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid health assessment", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.health_score).toBeGreaterThanOrEqual(0);
    expect(res.body.health_score).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("returns 400 for missing metrics", async () => {
    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .set(AUTH_HEADER)
      .send({ property: "Hotel" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("returns 422 if health_score is out of range after retry", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, health_score: 150 };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("strips sys_id from nested AI output", async () => {
    const outputWithNestedSysId = {
      ...VALID_AI_OUTPUT,
      issues: [{ category: "Test", severity: "low", finding: "test", sys_id: "abc123" }],
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(outputWithNestedSysId));

    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.issues[0]?.sys_id).toBeUndefined();
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/operations-intelligence")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
