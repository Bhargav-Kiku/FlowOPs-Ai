import "./testSetup";
import request from "supertest";
import { AUTH_HEADER } from "./testSetup";

// groq-sdk is CommonJS â€” mock returns the constructor directly (no .default wrapper)
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
    { intent: "engineering", confidence: 0.95, service_subtype: "hvac" },
    { intent: "housekeeping", confidence: 0.9, service_subtype: "delivery" },
  ],
  urgency: "high",
  sentiment: 4,
  priority: 2,
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
    expect(res.body.sentiment).toBe(4);
    expect(res.body.priority).toBe(2);
    expect(res.body.summary).toBeDefined();
    expect(res.body.intents[0].service_subtype).toBe("hvac");
    expect(res.body.intents[1].service_subtype).toBe("delivery");
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

describe("POST /api/v1/intent-classification â€” service_subtype", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  test("returns engineering subtype 'hvac' for AC-related requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "engineering", confidence: 0.97, service_subtype: "hvac" }],
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The AC in my room is not cooling at all", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("hvac");
  });

  test("returns engineering subtype 'plumbing' for water-related requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "engineering", confidence: 0.95, service_subtype: "plumbing" }],
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The toilet is overflowing", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("plumbing");
  });

  test("returns engineering subtype 'electrical' for power-related requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "engineering", confidence: 0.93, service_subtype: "electrical" }],
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The lights in the bathroom are not working", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("electrical");
  });

  test("returns engineering subtype 'networking' for Wi-Fi requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "engineering", confidence: 0.9, service_subtype: "networking" }],
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The Wi-Fi in my room keeps disconnecting", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("networking");
  });

  test("returns housekeeping subtype 'cleaning' for room cleaning requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "housekeeping", confidence: 0.98, service_subtype: "cleaning" }],
      urgency: "low",
      sentiment: 5,
      priority: 4,
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Please clean my room", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("cleaning");
  });

  test("returns housekeeping subtype 'delivery' for towel delivery requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "housekeeping", confidence: 0.96, service_subtype: "delivery" }],
      urgency: "low",
      sentiment: 5,
      priority: 4,
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Can you send me some extra towels?", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("delivery");
  });

  test("returns housekeeping subtype 'laundry' for laundry requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "housekeeping", confidence: 0.94, service_subtype: "laundry" }],
      urgency: "low",
      sentiment: 5,
      priority: 4,
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "I need my shirts dry cleaned", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("laundry");
  });

  test("returns housekeeping subtype 'turn_down' for turndown service requests", async () => {
    const aiOutput = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "housekeeping", confidence: 0.92, service_subtype: "turn_down" }],
      urgency: "low",
      sentiment: 5,
      priority: 4,
    };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Can you do turndown service tonight?", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("turn_down");
  });

  test("each intent carries its own subtype for multi-department requests", async () => {
    // VALID_AI_OUTPUT already has engineering=hvac, housekeeping=delivery
    mockCreate.mockResolvedValueOnce(mockGroqResponse(VALID_AI_OUTPUT));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.intents[0].service_subtype).toBe("hvac");
    expect(res.body.intents[1].service_subtype).toBe("delivery");
  });

  test("returns 422 when AI output is missing subtype on an intent", async () => {
    const outputWithoutSubtype = {
      intents: [{ intent: "engineering", confidence: 0.9 }], // subtype intentionally omitted
      urgency: "high",
      sentiment: 4,
      priority: 2,
      summary: "Guest reports a broken AC.",
    };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(outputWithoutSubtype))
      .mockResolvedValueOnce(mockGroqResponse(outputWithoutSubtype));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 when AI output has an invalid subtype value on an intent", async () => {
    const outputWithBadSubtype = {
      ...VALID_AI_OUTPUT,
      intents: [{ intent: "engineering", confidence: 0.95, service_subtype: "unknown_service" }],
    };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(outputWithBadSubtype))
      .mockResolvedValueOnce(mockGroqResponse(outputWithBadSubtype));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });
});

describe("POST /api/v1/intent-classification â€” priority, sentiment & urgency", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetClientForTesting();
  });

  // â”€â”€ Priority â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test("returns priority 1 (Critical) for life-safety requests", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, urgency: "critical", priority: 1, sentiment: 1 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "There is flooding in my bathroom and water is spreading everywhere!", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe(1);
    expect(res.body.urgency).toBe("critical");
  });

  test("returns priority 2 (High) for major disruption", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, urgency: "high", priority: 2, sentiment: 4 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The AC is broken. It is extremely hot in here.", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe(2);
  });

  test("returns priority 3 (Medium) for noticeable inconvenience", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, urgency: "medium", priority: 3, sentiment: 5 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "The minibar fridge seems to be making a loud noise.", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe(3);
  });

  test("returns priority 4 (Low) for minor requests", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, urgency: "low", priority: 4, sentiment: 5 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Could I get an extra pillow when you get a chance?", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe(4);
  });

  // â”€â”€ Sentiment codes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test("returns sentiment 1 (Urgent & Distressed) for panicked guest", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, sentiment: 1, priority: 1, urgency: "critical" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Please help! There is water coming through the ceiling!", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.sentiment).toBe(1);
  });

  test("returns sentiment 2 (Sarcastic) for sarcastic guest", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, sentiment: 2, priority: 3, urgency: "medium" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Oh great, the AC is broken again. What a surprise.", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.sentiment).toBe(2);
  });

  test("returns sentiment 3 (Aggressive) for hostile guest", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, sentiment: 3, priority: 2, urgency: "high" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "This is absolutely unacceptable! Fix the AC NOW or I am leaving!", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.sentiment).toBe(3);
  });

  test("returns sentiment 4 (Frustrated) for annoyed guest", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, sentiment: 4, priority: 2 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.sentiment).toBe(4);
  });

  test("returns sentiment 5 (Neutral) for calm guest", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, sentiment: 5, priority: 4, urgency: "low" };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Can I have some extra towels please?", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.sentiment).toBe(5);
  });

  // â”€â”€ Urgency â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test("returns urgency 'critical' for life-safety scenarios", async () => {
    const aiOutput = { ...VALID_AI_OUTPUT, urgency: "critical", priority: 1, sentiment: 1 };
    mockCreate.mockResolvedValueOnce(mockGroqResponse(aiOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send({ request: "Gas smell in the room, please help immediately!", property: "Grand Hotel", room: "402" });

    expect(res.status).toBe(200);
    expect(res.body.urgency).toBe("critical");
  });

  // â”€â”€ Schema rejections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test("returns 422 when AI omits the priority field", async () => {
    const { priority: _p, ...outputWithoutPriority } = VALID_AI_OUTPUT;
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(outputWithoutPriority))
      .mockResolvedValueOnce(mockGroqResponse(outputWithoutPriority));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 when AI returns an invalid priority value", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, priority: 5 };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 when AI returns an invalid sentiment value", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, sentiment: 6 };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 when AI returns sentiment as a string instead of a number", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, sentiment: "frustrated" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });

  test("returns 422 when AI returns an invalid urgency value", async () => {
    const badOutput = { ...VALID_AI_OUTPUT, urgency: "extreme" };
    mockCreate
      .mockResolvedValueOnce(mockGroqResponse(badOutput))
      .mockResolvedValueOnce(mockGroqResponse(badOutput));

    const res = await request(app)
      .post("/api/v1/intent-classification")
      .set(AUTH_HEADER)
      .send(VALID_INPUT);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ai_output");
  });
});
