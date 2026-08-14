# FlowOps AI Backend

> Groq-powered AI orchestration layer for the **FlowOps AI** ServiceNow scoped application — hotel operations management.

This service receives structured JSON from ServiceNow via Outbound REST Messages, calls Groq LLM, validates the output, and returns strict structured JSON. It **never** makes operational decisions, **never** creates or modifies records — it only classifies, recommends, and returns a `confidence` score. All decisions are made downstream by ServiceNow.

---

## Architecture

```
ServiceNow (Outbound REST Message)
        │
        ▼
FlowOps AI Backend (this service)
        │  ─ Auth: x-flowops-api-key header
        │  ─ Rate limit: 100 req / 15 min per key
        │  ─ Input validation (Zod)
        │  ─ Groq LLM call (JSON mode, 10s timeout)
        │  ─ Response guard (strips sys_ids, injects ai_role)
        │  ─ Output validation (Zod)
        ▼
Groq LLM API (llama-3.3-70b-versatile / llama-3.1-8b-instant)
```

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd flowops-ai-backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in GROQ_API_KEY and FLOWOPS_API_KEY

# 3. Run in development
npm run dev

# 4. Run tests (no real API calls — Groq is mocked)
npm test

# 5. Build for production
npm run build
npm start
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | — | Your Groq API key |
| `GROQ_MODEL` | ❌ | `llama-3.3-70b-versatile` | Primary LLM model |
| `GROQ_FAST_MODEL` | ❌ | `llama-3.1-8b-instant` | Fast model for `/summary` |
| `FLOWOPS_API_KEY` | ✅ | — | Shared secret for ServiceNow auth |
| `PORT` | ❌ | `3000` | Server listen port |
| `NODE_ENV` | ❌ | `development` | Node environment |
| `RATE_LIMIT_MAX` | ❌ | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `900000` | Rate limit window (15 min) |
| `LOG_LEVEL` | ❌ | `info` | Pino log level |

---

## Authentication

Every request to `/api/v1/*` must include:

```
x-flowops-api-key: <your FLOWOPS_API_KEY value>
```

Missing or incorrect key → `401 Unauthorized`.

---

## API Reference & curl Examples

All endpoints: `POST`, `Content-Type: application/json`, base path `/api/v1/`.

Replace `YOUR_API_KEY` with the value of `FLOWOPS_API_KEY` in your `.env`.

---

### 1. `POST /api/v1/intent-classification`

Classifies a guest request into one or more operational intents with urgency and sentiment.

```bash
curl -X POST http://localhost:3000/api/v1/intent-classification \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "request": "The AC unit is making a loud noise and I need fresh towels urgently",
    "property": "Grand Hotel Dubai",
    "room": "402",
    "departments": [
      {
        "department": "engineering",
        "skills": [
          { "name": "hvac", "description": "mechanical, electrical, plumbing, HVAC" }
        ]
      },
      {
        "department": "housekeeping",
        "skills": [
          { "name": "cleaning", "description": "cleaning, linens, towels" }
        ]
      }
    ]
  }'
```

**Response:**
```json
{
  "intents": [
    { "intent": "engineering", "confidence": 0.94, "case_detail": "noisy AC unit" },
    { "intent": "housekeeping", "confidence": 0.91, "case_detail": "urgent fresh towels" }
  ],
  "urgency": "high",
  "sentiment": "negative",
  "summary": "Guest in room 402 reports a noisy AC unit and urgently needs fresh towels.",
  "ai_role": "recommendation_only",
  "_meta": { "model": "llama-3.3-70b-versatile", "retried": false, "requestId": "..." }
}
```

**Valid intent values:** `engineering` | `housekeeping` | `vendor` | `guest_services` | `other`

---

### 2. `POST /api/v1/housekeeping-assign`

Recommends the best staff member using priority logic: on_shift → same_property → skill → lowest workload. While originally for housekeeping, this endpoint supports both `housekeeping` and `engineering` domains.

**Example 1: Housekeeping (Default)**
```bash
curl -X POST http://localhost:3000/api/v1/housekeeping-assign \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "guest_case_id": "CASE-2024-001",
    "room": "301",
    "property": "Grand Hotel Dubai",
    "task_type": "linen_change",
    "severity": 1,
    "candidates": [
      {
        "index": 0,
        "staff_id": "HK-101",
        "name": "Sarah Ahmed",
        "on_shift": true,
        "same_property": true,
        "has_required_skill": true,
        "current_room_count": 3
      },
      {
        "index": 1,
        "staff_id": "HK-102",
        "name": "Priya Sharma",
        "on_shift": true,
        "same_property": true,
        "has_required_skill": true,
        "current_room_count": 6
      }
    ]
  }'
```

**Response:**
```json
{
  "recommended_index": 0,
  "reason": "Sarah Ahmed meets all criteria and has the lowest current workload (3 rooms vs 6).",
  "confidence": 0.95,
  "ai_role": "recommendation_only"
}
```

**Example 2: Engineering**
```bash
curl -X POST http://localhost:3000/api/v1/housekeeping-assign \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "domain": "engineering",
    "guest_case_id": "CASE-2024-002",
    "room": "412",
    "property": "Grand Hotel Dubai",
    "task_type": "hvac_repair",
    "candidates": [
      {
        "staff_id": "ENG-201",
        "name": "Mike Johnson",
        "on_shift": true,
        "same_property": true,
        "has_required_skill": true,
        "current_room_count": 1
      },
      {
        "staff_id": "ENG-202",
        "name": "David Smith",
        "on_shift": true,
        "same_property": true,
        "has_required_skill": false,
        "current_room_count": 0
      }
    ]
  }'
```

**Response:**
```json
{
  "recommended_index": 0,
  "reason": "Mike Johnson is on shift, at the same property, and has the required hvac_repair skill.",
  "confidence": 0.95,
  "ai_role": "recommendation_only"
}
```

> **Note:** If no candidate satisfies `on_shift + same_property + has_required_skill`, `recommended_index` will be `null`. The backend also enforces this in code — AI cannot bypass it.

---

### 3. `POST /api/v1/engineering-triage`

Triages an engineering issue given asset details, history, and criticality.

```bash
curl -X POST http://localhost:3000/api/v1/engineering-triage \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "guest_case_id": "CASE-2024-002",
    "service_subtype": "hvac",
    "priority": 1,
    "description": "AC unit in room is leaking water and not cooling",
    "room": "510",
    "property": "Grand Hotel Dubai",
    "assets": [
      {
        "asset_name": "AC Unit Carrier",
        "asset_type": "HVAC",
        "status": "active",
        "criticality": "high"
      }
    ]
  }'
```

**Response:**
```json
{
  "problem_category": "HVAC Failure",
  "recommended_action": "Inspect wiring and replace switch",
  "routing_decision": "vendor_direct",
  "suggested_priority": 2,
  "confidence": 0.87,
  "ai_role": "recommendation_only",
  "_meta": { "model": "llama-3.3-70b-versatile", "retried": false, "requestId": "..." }
}
```

---

### 4. `POST /api/v1/vendor-recommendation`

Recommends the best vendor from a list using SLA, rating, response time, and cost scoring.

```bash
curl -X POST http://localhost:3000/api/v1/vendor-recommendation \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "guest_case_id": "CASE-2024-002",
    "task_type": "elevator_maintenance",
    "severity": 1,
    "property": "Grand Hotel Dubai",
    "candidates": [
      {
        "index": 0,
        "vendor_id": "VND-001",
        "name": "Acme Lift Services",
        "rating": 4.5,
        "sla_response_time_hrs": 4,
        "contract_status": "Active"
      },
      {
        "index": 1,
        "vendor_id": "VND-002",
        "name": "QuickFix Elevators",
        "rating": 3.8,
        "sla_response_time_hrs": 2,
        "contract_status": "Preferred"
      },
      {
        "index": 2,
        "vendor_id": "VND-003",
        "name": "Premier Vertical",
        "rating": 4.9,
        "sla_response_time_hrs": 6,
        "contract_status": "Emergency Only"
      }
    ]
  }'
```

**Response:**
```json
{
  "recommended_index": 1,
  "reason": "QuickFix Elevators meets the 2-hour SLA response time for severity 1 issues and has Preferred contract status.",
  "confidence": 0.88,
  "ai_role": "recommendation_only",
  "_meta": { "model": "llama-3.3-70b-versatile", "retried": false, "requestId": "..." }
}
```

---

### 5. `POST /api/v1/operations-intelligence`

Analyzes hotel operational metrics and produces a health score, issues list, and recommendations.

```bash
curl -X POST http://localhost:3000/api/v1/operations-intelligence \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "property": "Grand Hotel Dubai",
    "period": "2024-Q3",
    "metrics": {
      "guest_requests": 1240,
      "sla_breach_percentage": 14.2,
      "engineering_backlog": 28,
      "guest_satisfaction": 6.8,
      "vendor_rating": 3.9,
      "avg_resolution_time_hours": 5.4,
      "staff_utilization_percentage": 91,
      "occupancy_percentage": 88
    }
  }'
```

**Response:**
```json
{
  "health_score": 52,
  "issues": [
    {
      "category": "Engineering",
      "severity": "high",
      "finding": "Engineering backlog of 28 items significantly exceeds the 20-item threshold, indicating capacity constraints."
    },
    {
      "category": "SLA Compliance",
      "severity": "high",
      "finding": "SLA breach rate of 14.2% exceeds the acceptable 10% threshold."
    },
    {
      "category": "Staffing",
      "severity": "medium",
      "finding": "Staff utilization at 91% risks burnout and service quality degradation."
    }
  ],
  "recommendations": [
    "Hire or cross-train 2-3 additional engineering staff to address the backlog within 30 days",
    "Review and renegotiate vendor SLAs — current performance at 14.2% breach rate is untenable",
    "Implement shift overlap coverage during peak occupancy periods to reduce resolution time"
  ],
  "ai_role": "recommendation_only"
}
```

---

### 6. `POST /api/v1/summary`

Generates a concise 2-4 sentence summary of any hotel operations context. Uses the fast model (`llama-3.1-8b-instant`) for low latency.

```bash
curl -X POST http://localhost:3000/api/v1/summary \
  -H "Content-Type: application/json" \
  -H "x-flowops-api-key: YOUR_API_KEY" \
  -d '{
    "context": {
      "type": "guest_request",
      "guest_name": "James Wilson",
      "room": "712",
      "property": "Grand Hotel Dubai",
      "request": "AC not cooling, room temperature is 29°C. Also requested extra towels.",
      "submitted_at": "2024-08-01T14:22:00Z",
      "status": "open"
    }
  }'
```

**Response:**
```json
{
  "summary": "Guest James Wilson in room 712 has reported that the AC unit is not cooling, with room temperature at 29°C. An additional request for extra towels was submitted alongside the engineering complaint. The case was opened on August 1st and is currently unresolved.",
  "ai_role": "recommendation_only",
  "_meta": { "model": "llama-3.1-8b-instant", "retried": false }
}
```

---

## Confidence Score Tiers

The `confidence` field (0–1) is returned on every applicable endpoint. ServiceNow is responsible for acting on these tiers:

| Range | Tier | ServiceNow Action |
|---|---|---|
| ≥ 0.85 | High | Auto-approve recommendation |
| 0.60–0.84 | Medium | Route to supervisor for review |
| < 0.60 | Low | Require manual decision |

> This service never applies automation logic — it only provides the score.

---

## Error Responses

| HTTP | `error` field | Cause |
|---|---|---|
| `400` | `invalid_input` | Request body fails Zod validation |
| `401` | `unauthorized` | Missing or invalid `x-flowops-api-key` |
| `403` | `forbidden` | Browser/Origin header detected (not server-to-server) |
| `422` | `invalid_ai_output` | Groq returned malformed/invalid JSON after one retry |
| `429` | `rate_limit_exceeded` | Too many requests from this API key |
| `502` | `ai_unavailable` | Groq API timed out or returned an error |
| `500` | `internal_server_error` | Unexpected server error |

---

## ServiceNow Outbound REST Message Setup

### 1. Create a REST Message

In your ServiceNow instance:

1. Navigate to **System Web Services → Outbound → REST Messages**
2. Click **New** and fill in:
   - **Name:** `FlowOps AI Backend`
   - **Endpoint:** `https://your-backend-host.com` (your deployed URL)
   - **Authentication type:** `No authentication` (key is in header)

### 2. Add Authentication Header

In the **HTTP Request** tab, add a header:
- **Name:** `x-flowops-api-key`
- **Value:** (the value of your `FLOWOPS_API_KEY`)

Add `Content-Type: application/json` as well.

### 3. Create HTTP Methods

For each endpoint, create an **HTTP Method** under the REST Message:

| Method Name | HTTP Method | Endpoint |
|---|---|---|
| Intent Classification | POST | `${endpoint}/api/v1/intent-classification` |
| Housekeeping Assign | POST | `${endpoint}/api/v1/housekeeping-assign` |
| Engineering Triage | POST | `${endpoint}/api/v1/engineering-triage` |
| Vendor Recommendation | POST | `${endpoint}/api/v1/vendor-recommendation` |
| Operations Intelligence | POST | `${endpoint}/api/v1/operations-intelligence` |
| Summary | POST | `${endpoint}/api/v1/summary` |

### 4. Call from Flow Designer / Business Rule

```javascript
// Example: Call intent-classification from a Business Rule
var r = new sn_ws.RESTMessageV2('FlowOps AI Backend', 'Intent Classification');
r.setRequestBody(JSON.stringify({
  request: current.description,
  property: current.u_property,
  room: current.u_room_number
}));

var response = r.execute();
var responseBody = JSON.parse(response.getBody());

// Store results back on the record
current.u_ai_intent = responseBody.intents[0].intent;
current.u_ai_urgency = responseBody.urgency;
current.u_ai_confidence = responseBody.intents[0].confidence;
current.u_ai_role = responseBody.ai_role; // always "recommendation_only"
```

### 5. Logging to `ai_orchestrator_log`

The `_meta` field in every response maps directly to your logging table:

```javascript
// After calling the AI backend
var meta = responseBody._meta;
var logRecord = new GlideRecord('u_ai_orchestrator_log');
logRecord.initialize();
logRecord.u_request_id = meta.requestId;
logRecord.u_endpoint = 'intent-classification';
logRecord.u_model = meta.model;
logRecord.u_prompt_tokens = meta.usage.promptTokens;
logRecord.u_completion_tokens = meta.usage.completionTokens;
logRecord.u_retried = meta.retried;
logRecord.insert();
```

---

## Project Structure

```
flowops-ai-backend/
├── src/
│   ├── lib/
│   │   ├── auth.ts           # API key middleware (constant-time compare)
│   │   ├── groqClient.ts     # Groq SDK wrapper: retry, timeout, validation
│   │   ├── logger.ts         # Pino structured logger
│   │   └── responseGuard.ts  # Strips sys_ids, injects ai_role
│   ├── prompts/              # System prompts (one per endpoint)
│   ├── routes/               # Express routes (one per endpoint)
│   ├── schemas/              # Zod input + output schemas
│   ├── tests/                # Jest tests (Groq mocked)
│   └── server.ts             # Express app entry point
├── .env.example
├── .gitignore
├── jest.config.ts
├── package.json
├── README.md
└── tsconfig.json
```

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`
- This service is **server-to-server only** — it rejects any request with an HTTP `Origin` header
- The API key comparison uses Node.js `timingSafeEqual` to prevent timing attacks
- No database access — this service is completely stateless
- Rate limiting is applied per API key (in-memory; restart resets counters)
