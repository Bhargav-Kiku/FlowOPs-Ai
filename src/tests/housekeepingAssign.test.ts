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
    usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
  };
}

const VALID_INPUT = {
  guest_case_id: "CASE-001",
  room: "301",
  property: "Grand Hotel",
  task_type: "linen_change",
  candidates: [
    { staff_id: "STAFF-A", name: "Alice", on_shift: true, same_property: true, has_required_skill: true, current_room_count: 3 },
    { staff_id: "STAFF-B", name: "Bob", on_shift: false, same_property: true, has_required_skill: true, current_room_count: 1 },
  ],
};

describe("POST /api/v1/housekeeping-assign", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns 200 with valid assignment when AI picks a valid on-shift candidate", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_staff_id: "STAFF-A", reason: "Alice is on shift with required skill", confidence: 0.95 })
    );

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.recommended_staff_id).toBe("STAFF-A");
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("overrides AI pick to null when AI recommends an off-shift staff member", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_staff_id: "STAFF-B", reason: "Bob has lowest workload", confidence: 0.7 })
    );

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.recommended_staff_id).toBeNull();
    expect(res.body.confidence).toBe(0);
    expect(res.body.ai_role).toBe("recommendation_only");
  });

  test("returns null when AI returns null (no suitable candidate)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_staff_id: null, reason: "No on-shift staff with required skill", confidence: 0 })
    );

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.recommended_staff_id).toBeNull();
  });

  test("overrides to null when AI returns a staff_id not in candidates list", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_staff_id: "STAFF-GHOST", reason: "Hallucinated staff", confidence: 0.9 })
    );

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.recommended_staff_id).toBeNull();
  });

  test("returns 400 for missing candidates", async () => {
    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send({ guest_case_id: "CASE-001", room: "301", property: "Hotel", task_type: "clean" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  test("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .send(VALID_INPUT);

    expect(res.status).toBe(401);
  });

  test("returns 422 if AI output is malformed after retry", async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: "bad json" } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: "still bad" } }], usage: {} });

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
  });

  test("always injects ai_role: recommendation_only", async () => {
    mockCreate.mockResolvedValueOnce(
      mockGroqResponse({ recommended_staff_id: "STAFF-A", reason: "Best match", confidence: 0.9 })
    );

    const res = await request(app)
      .post("/api/v1/housekeeping-assign")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.body.ai_role).toBe("recommendation_only");
  });
});
