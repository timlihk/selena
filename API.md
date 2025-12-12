# 🔌 API Documentation

Complete API reference for the Baby Event Tracker application.

**Base URL**: `https://selena.mangrove-hk.org` (or `http://localhost:3000` for local development)

All API endpoints return JSON responses and support CORS for cross-origin requests.

**Current Version**: 1.5.0

**Key Features**:
- Event tracking (milk, sleep, diaper, bath)
- Baby profile with age calculation
- Growth measurements tracking
- AI-powered insights via DeepSeek
- Real-time sleep session tracking
- Daily statistics and patterns

---

## 📋 API Overview

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|----------------|
| `GET` | `/api/events` | Get all events (filterable) | None |
| `POST` | `/api/events` | Create new event | None |
| `PUT` | `/api/events/:id` | Update existing event | None |
| `DELETE` | `/api/events/:id` | Delete specific event | None |
| `POST` | `/api/events/confirmed-sleep` | Create sleep bypassing validation | None |
| `GET` | `/api/stats/today` | Get today's statistics | None |
| `GET` | `/api/sleep/active` | Get active sleep sessions | None |
| `GET` | `/api/baby-profile` | Get baby profile with age | None |
| `POST` | `/api/baby-profile` | Create/update baby profile | None |
| `GET` | `/api/baby-measurements` | Get all growth measurements | None |
| `POST` | `/api/baby-measurements` | Add new measurement | None |
| `GET` | `/api/ai-insights` | Get AI-enhanced insights | None |
| `POST` | `/api/ai-insights/refresh` | Manual AI refresh (requires token) | X-Refresh-Token header |
| `GET` | `/api/ai-insights/health` | DeepSeek API health check | None |
| `GET` | `/api/config` | Get server configuration | None |
| `GET` | `/health` | Health check | None |
| `GET` | `/` | Serve frontend application | None |

---

## 📊 Events Endpoints

### Get All Events

Retrieve all recorded baby events in reverse chronological order. Supports filtering by event type and advanced JSON filtering.

**Endpoint**: `GET /api/events`

**Query Parameters**:

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `type` | string | ❌ | Filter by event type | `?type=milk` |
| `filter` | string (JSON) | ❌ | Advanced filter expression | `?filter={"startDate":"2025-01-01","endDate":"2025-01-31"}` |

**Response**:
```json
[
  {
    "id": 1,
    "type": "milk",
    "amount": 120,
    "timestamp": "2025-11-13T01:30:00.000Z",
    "user_name": "Tim",
    "subtype": null,
    "sleep_start_time": null,
    "sleep_end_time": null,
    "sleep_subtype": null
  },
  {
    "id": 2,
    "type": "diaper",
    "amount": null,
    "timestamp": "2025-11-13T01:15:00.000Z",
    "user_name": "Angie",
    "subtype": "poo",
    "sleep_start_time": null,
    "sleep_end_time": null,
    "sleep_subtype": null
  },
  {
    "id": 3,
    "type": "sleep",
    "amount": 45,
    "timestamp": "2025-11-13T02:00:00.000Z",
    "user_name": "Charie",
    "subtype": null,
    "sleep_start_time": "2025-11-13T01:15:00.000Z",
    "sleep_end_time": "2025-11-13T02:00:00.000Z",
    "sleep_subtype": "fall_asleep"
  }
]
```

**Status Codes**:
- `200` - Success
- `400` - Invalid filter or type parameter
- `500` - Internal server error

---

### Create New Event

Record a new baby event.

**Endpoint**: `POST /api/events`

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "type": "milk",
  "amount": 150,
  "userName": "Tim",
  "timestamp": "2025-11-13T01:45:00.000Z",
  "diaperSubtype": "pee",
  "sleepSubType": "fall_asleep",
  "sleepStartTime": "2025-11-13T01:15:00.000Z",
  "sleepEndTime": "2025-11-13T02:00:00.000Z"
}
```

**Parameters**:

| Parameter | Type | Required | Description | Constraints |
|-----------|------|----------|-------------|-------------|
| `type` | string | ✅ | Event type | `milk`, `diaper`, `poo` (legacy), `bath`, `sleep` |
| `userName` | string | ✅ | Who is recording the event | Must be one of: Charie, Angie, Tim, Mengyu |
| `amount` | integer | ❌ | Quantity payload | Required for `milk` (ml) and manual `sleep` entries (minutes) |
| `timestamp` | string (ISO) | ❌ | Event timestamp | Defaults to current time |
| `diaperSubtype` | string | ❌ | Diaper detail | Required when `type` is `diaper`; one of `pee`, `poo`, `both` |
| `sleepSubType` | string | ❌ | Sleep action | `fall_asleep` or `wake_up` for automatic sleep tracking |
| `sleepStartTime` | string (ISO) | ❌ | Sleep start time | Required for sleep sessions with `sleepSubType` |
| `sleepEndTime` | string (ISO) | ❌ | Sleep end time | Required for sleep sessions with `sleepSubType` |

**Response**:
```json
{
  "id": 3,
  "type": "milk",
  "amount": 150,
  "timestamp": "2025-11-13T01:45:00.000Z",
  "user_name": "Tim",
  "subtype": null,
  "sleep_start_time": null,
  "sleep_end_time": null,
  "sleep_subtype": null
}
```

**Status Codes**:
- `201` - Event created successfully
- `400` - Invalid request (missing type, invalid amount, etc.)
- `500` - Internal server error

**Validation Rules**:
- `type` must be one of the allowed event types
- `userName` must be an allowed caregiver
- `milk` events require a positive `amount` (1-500 ml)
- `sleep` events using manual entry require a positive `amount` (1-480 minutes)
- `diaper` events require a valid `diaperSubtype`
- `sleepSubType` events require both `sleepStartTime` and `sleepEndTime`
- Legacy `poo` events are automatically converted to `diaper` with `poo` subtype
- **Sleep auto-completion**: When a non-sleep event is created, any active sleep session for that user is automatically completed with the new event's timestamp as the end time

---

### Update Event

Update an existing event by ID.

**Endpoint**: `PUT /api/events/:id`

**Headers**:
```
Content-Type: application/json
```

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | ✅ | Event ID to update |

**Request Body**: Same fields as Create New Event (all fields optional except those required for the event type).

**Response**:
```json
{
  "id": 3,
  "type": "milk",
  "amount": 180,
  "timestamp": "2025-11-13T01:45:00.000Z",
  "user_name": "Tim",
  "subtype": null,
  "sleep_start_time": null,
  "sleep_end_time": null,
  "sleep_subtype": null
}
```

**Status Codes**:
- `200` - Event updated successfully
- `400` - Invalid request data
- `404` - Event not found
- `500` - Internal server error

---

### Delete Event

Remove a specific event by ID.

**Endpoint**: `DELETE /api/events/:id`

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | ✅ | Event ID to delete |

**Response**:
```json
{
  "message": "Event deleted successfully"
}
```

**Status Codes**:
- `200` - Event deleted successfully
- `500` - Internal server error

---

### Create Confirmed Sleep

Create a sleep event bypassing duration validation (for unusually long sleep sessions).

**Endpoint**: `POST /api/events/confirmed-sleep`

**Headers**:
```
Content-Type: application/json
```

**Request Body**: Same as Create New Event for sleep events.

**Response**: Same as Create New Event.

**Status Codes**:
- `201` - Sleep event created successfully
- `400` - Invalid request data
- `500` - Internal server error

**Note**: This endpoint allows creating sleep events longer than the normal maximum duration (480 minutes) without triggering validation warnings. Use for recording unusually long sleep sessions (e.g., overnight sleep).

---

## 💤 Sleep Endpoints

### Get Active Sleep Sessions

Check for incomplete sleep sessions across all caregivers.

**Endpoint**: `GET /api/sleep/active`

**Response**:
```json
{
  "success": true,
  "hasActiveSleep": true,
  "sessions": [
    {
      "id": 123,
      "userName": "Tim",
      "startTime": "2025-11-13T01:15:00.000Z",
      "elapsedMinutes": 45,
      "elapsedFormatted": "45m"
    }
  ]
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `hasActiveSleep` | boolean | Whether any active sleep sessions exist |
| `sessions` | array | Array of active sleep session objects |
| `sessions[].id` | integer | Event ID of the sleep session |
| `sessions[].userName` | string | Caregiver who started the sleep session |
| `sessions[].startTime` | string (ISO) | When the sleep session started |
| `sessions[].elapsedMinutes` | integer | Minutes since sleep start |
| `sessions[].elapsedFormatted` | string | Human-readable elapsed time (e.g., "2h 15m") |

**Status Codes**:
- `200` - Success
- `500` - Internal server error

---

## 📈 Statistics Endpoints

### Get Today's Statistics

Retrieve aggregated statistics for today's events (based on server's configured timezone).

**Endpoint**: `GET /api/stats/today`

**Response**:
```json
{
  "milk": 5,
  "poo": 3,
  "bath": 1,
  "sleep": 4,
  "totalMilk": 620,
  "totalSleepHours": 8.5,
  "totalDiapers": 3,
  "totalSleepMinutes": 510
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `milk` | integer | Number of milk events today |
| `poo` | integer | Number of diaper change events today (legacy `poo` + new `diaper` types) |
| `bath` | integer | Number of bath events today |
| `sleep` | integer | Number of sleep sessions recorded today |
| `totalMilk` | integer | Total milk consumed today (in ml) |
| `totalSleepHours` | number | Total hours of sleep recorded today |
| `totalDiapers` | integer | Total diaper changes today (all subtypes) |
| `totalSleepMinutes` | integer | Total minutes of sleep recorded today |

**Status Codes**:
- `200` - Success
- `500` - Internal server error

---

## 👶 Baby Profile Endpoints

### Get Baby Profile

Get the baby's profile information including calculated age.

**Endpoint**: `GET /api/baby-profile`

**Response**:
```json
{
  "success": true,
  "profile": {
    "id": 1,
    "name": "Selena",
    "date_of_birth": "2025-09-01",
    "created_at": "2025-09-01T00:00:00.000Z",
    "updated_at": "2025-11-13T12:00:00.000Z"
  },
  "latestMeasurement": {
    "weight_kg": 4.2,
    "height_cm": 55,
    "head_circumference_cm": 38,
    "measurement_date": "2025-11-10"
  },
  "age": {
    "weeks": 12,
    "days": 3
  }
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `profile` | object or null | Baby profile object |
| `profile.name` | string | Baby's name |
| `profile.date_of_birth` | string (YYYY-MM-DD) | Date of birth |
| `latestMeasurement` | object or null | Latest growth measurement |
| `latestMeasurement.weight_kg` | number | Weight in kilograms |
| `latestMeasurement.height_cm` | number | Height in centimeters |
| `latestMeasurement.head_circumference_cm` | number | Head circumference in cm |
| `latestMeasurement.measurement_date` | string (YYYY-MM-DD) | Date of measurement |
| `age` | object | Calculated age from DOB |
| `age.weeks` | integer | Whole weeks since birth |
| `age.days` | integer | Remaining days after weeks |

**Status Codes**:
- `200` - Success
- `500` - Internal server error

### Create/Update Baby Profile

Create or update the baby's profile (name and date of birth).

**Endpoint**: `POST /api/baby-profile`

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "name": "Selena",
  "date_of_birth": "2025-09-01"
}
```

**Parameters**:

| Parameter | Type | Required | Description | Constraints |
|-----------|------|----------|-------------|-------------|
| `name` | string | ✅ | Baby's name | 1-100 characters |
| `date_of_birth` | string | ✅ | Date of birth | YYYY-MM-DD format, must be in past |

**Response**: Same as Get Baby Profile.

**Status Codes**:
- `200` - Profile created/updated successfully
- `400` - Invalid request data
- `500` - Internal server error

---

## 📏 Baby Measurements Endpoints

### Get All Measurements

Retrieve all growth measurement records in chronological order.

**Endpoint**: `GET /api/baby-measurements`

**Response**:
```json
{
  "success": true,
  "measurements": [
    {
      "id": 1,
      "measurement_date": "2025-09-15",
      "weight_kg": 3.5,
      "height_cm": 50,
      "head_circumference_cm": 35,
      "notes": "2-week checkup"
    },
    {
      "id": 2,
      "measurement_date": "2025-10-15",
      "weight_kg": 4.0,
      "height_cm": 53,
      "head_circumference_cm": 36.5,
      "notes": "1-month checkup"
    }
  ]
}
```

**Status Codes**:
- `200` - Success
- `500` - Internal server error

### Add New Measurement

Record a new growth measurement.

**Endpoint**: `POST /api/baby-measurements`

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "measurement_date": "2025-11-10",
  "weight_kg": 4.2,
  "height_cm": 55,
  "head_circumference_cm": 38,
  "notes": "2-month checkup"
}
```

**Parameters**:

| Parameter | Type | Required | Description | Constraints |
|-----------|------|----------|-------------|-------------|
| `measurement_date` | string | ✅ | Date of measurement | YYYY-MM-DD format |
| `weight_kg` | number | ❌ | Weight in kilograms | 1.5-20 kg (WHO ranges) |
| `height_cm` | number | ❌ | Height in centimeters | 40-100 cm (WHO ranges) |
| `head_circumference_cm` | number | ❌ | Head circumference in cm | 30-55 cm (WHO ranges) |
| `notes` | string | ❌ | Additional notes | Optional, max 500 characters |

At least one measurement value (`weight_kg`, `height_cm`, or `head_circumference_cm`) is required.

**Response**: Same as Get All Measurements.

**Status Codes**:
- `201` - Measurement created successfully
- `400` - Invalid request data
- `500` - Internal server error

---

## 🤖 AI Insights Endpoints

### Get AI-Enhanced Insights

Get AI-powered analysis of baby's patterns using DeepSeek API. Insights are cached for 23 hours.

**Endpoint**: `GET /api/ai-insights`

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | ❌ | Force refresh insights (bypass cache) | `?force=1` or `?force=true` |
| `goal` | string | ❌ | Custom analysis goal | e.g., `?goal=improve_sleep` |
| `concerns` | string | ❌ | Comma-separated concerns | e.g., `?concerns=low_weight,short_naps` |

**Response**:
```json
{
  "success": true,
  "aiEnhanced": {
    "insights": [
      {
        "title": "Optimal Feeding Window Found",
        "description": "Baby sleeps 45 minutes longer when fed at 7 PM compared to other times.",
        "type": "feeding",
        "confidence": 0.85,
        "recommendation": "Try consistent 7 PM feeds for better sleep",
        "whyItMatters": "Longer sleep supports brain development and growth",
        "priority": 1
      }
    ],
    "alerts": [
      {
        "title": "Low Wet Diapers",
        "severity": "medium",
        "note": "Only 3 wet diapers in last 24 hours (recommended: 6+ for age)",
        "priority": 2
      }
    ],
    "miniPlan": {
      "tonightBedtimeTarget": "19:30",
      "nextWakeWindows": ["1h30m", "2h"],
      "feedingNote": "Offer extra 20ml at bedtime feed"
    },
    "measureOfSuccess": "Baby sleeps through 2-hour blocks tonight with fewer night wakings"
  },
  "statistical": {
    "feedingPatterns": { ... },
    "sleepDistribution": { ... },
    "wakeWindows": { ... },
    "diaperPatterns": { ... }
  },
  "timestamp": "2025-11-13T14:30:00.000Z",
  "dataQuality": {
    "days": 45,
    "sufficient": true,
    "totalEvents": 1200
  }
}
```

**Status Codes**:
- `200` - Success (cached or newly generated)
- `503` - AI service temporarily unavailable
- `500` - Internal server error

**Requirements**:
- Minimum 10 days of tracking data
- Valid `DEEPSEEK_API_KEY` environment variable (optional - falls back to statistical insights only)

### Manual AI Refresh

Manually trigger AI insights refresh with authentication token.

**Endpoint**: `POST /api/ai-insights/refresh`

**Headers**:
```
X-Refresh-Token: your-refresh-token
```
or query parameter: `?token=your-refresh-token`

**Request Body**: None

**Response**: Same as Get AI-Enhanced Insights.

**Status Codes**:
- `200` - Refresh successful
- `401` - Invalid or missing refresh token
- `404` - Manual refresh not enabled (no `DEEPSEEK_REFRESH_TOKEN` configured)
- `429` - Too many refresh requests (5-minute cooldown)
- `500` - Internal server error

### DeepSeek API Health Check

Check DeepSeek API connectivity and key validity.

**Endpoint**: `GET /api/ai-insights/health`

**Response**:
```json
{
  "success": true,
  "status": 200,
  "error": null
}
```

**Status Codes**:
- `200` - DeepSeek API reachable and key valid
- `503` - DeepSeek API unreachable or key invalid
- `500` - Internal server error

---

## ⚙️ Configuration Endpoint

### Get Server Configuration

Get public server configuration (timezone, allowed users, etc.).

**Endpoint**: `GET /api/config`

**Response**:
```json
{
  "homeTimezone": "Asia/Hong_Kong",
  "allowedUsers": ["Charie", "Angie", "Tim", "Mengyu"],
  "allowedEventTypes": ["milk", "diaper", "poo", "bath", "sleep"],
  "allowedDiaperSubtypes": ["pee", "poo", "both"],
  "defaultBabyAgeWeeks": 8,
  "deepseekConfigured": true
}
```

**Status Codes**:
- `200` - Success
- `500` - Internal server error

---

## 🩺 Health Check

Check if the API is running and healthy.

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "OK",
  "message": "Baby Tracker API is running",
  "timestamp": "2025-11-13T14:30:00.000Z",
  "version": "1.5.0"
}
```

**Status Codes**:
- `200` - API is healthy

---

## 🔒 Error Handling

All API endpoints follow consistent error handling patterns.

### Error Response Format

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "details": "Additional error details (optional)"
}
```

### Common Error Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| `400` | Bad Request | Invalid input, missing required fields, validation failure |
| `401` | Unauthorized | Invalid refresh token for manual AI refresh |
| `404` | Not Found | Route not found, resource not found |
| `429` | Too Many Requests | Rate limit exceeded or manual refresh cooldown |
| `500` | Internal Server Error | Database issues, unexpected errors |
| `503` | Service Unavailable | DeepSeek API unavailable, AI insights generation failed |

### Example Error Responses

**Invalid Event Type**:
```json
{
  "success": false,
  "error": "Invalid event type. Must be one of: milk, diaper, poo, bath, sleep"
}
```

**Missing Required Field**:
```json
{
  "success": false,
  "error": "User name is required"
}
```

**Rate Limited**:
```json
{
  "success": false,
  "error": "Too many requests. Please wait 15 minutes."
}
```

---

## 🧪 API Testing

### Using cURL

**Get all events**:
```bash
curl https://selena.mangrove-hk.org/api/events
```

**Create milk event**:
```bash
curl -X POST https://selena.mangrove-hk.org/api/events \
  -H "Content-Type: application/json" \
  -d '{"type": "milk", "amount": 120, "userName": "Tim"}'
```

**Create sleep event with automatic tracking**:
```bash
curl -X POST https://selena.mangrove-hk.org/api/events \
  -H "Content-Type: application/json" \
  -d '{"type": "sleep", "sleepSubType": "fall_asleep", "sleepStartTime": "2025-11-13T01:15:00.000Z", "sleepEndTime": "2025-11-13T02:00:00.000Z", "userName": "Charie"}'
```

**Get AI insights**:
```bash
curl https://selena.mangrove-hk.org/api/ai-insights
```

**Force refresh AI insights**:
```bash
curl "https://selena.mangrove-hk.org/api/ai-insights?force=1"
```

**Get baby profile**:
```bash
curl https://selena.mangrove-hk.org/api/baby-profile
```

**Add measurement**:
```bash
curl -X POST https://selena.mangrove-hk.org/api/baby-measurements \
  -H "Content-Type: application/json" \
  -d '{"measurement_date": "2025-11-10", "weight_kg": 4.2, "height_cm": 55}'
```

**Health check**:
```bash
curl https://selena.mangrove-hk.org/health
```

### Using JavaScript Fetch

```javascript
// Get all events
const response = await fetch('https://selena.mangrove-hk.org/api/events');
const events = await response.json();

// Create new event
const newEvent = await fetch('/api/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'milk',
    amount: 150,
    userName: 'Tim'
  })
});

// Get AI insights
const insights = await fetch('/api/ai-insights?force=1').then(r => r.json());

// Handle errors
if (!response.ok) {
  const error = await response.json();
  console.error('API Error:', error.error);
}
```

---

## 🔄 Rate Limiting

The API implements rate limiting to prevent abuse:

- **Limit**: 100 requests per 15 minutes per IP address
- **Response**: `429 Too Many Requests` when limit exceeded
- **Headers**: Standard rate limit headers included (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)

---

## 🌐 CORS Configuration

The API supports Cross-Origin Resource Sharing (CORS) with the following configuration:

- **Allowed Origins**: All origins (`*`)
- **Allowed Methods**: GET, POST, PUT, DELETE
- **Allowed Headers**: Content-Type, X-Refresh-Token
- **Credentials**: Not required

---

## 📊 Data Models

### Event Object

```typescript
interface Event {
  id: number;                          // Auto-incrementing primary key
  type: 'milk' | 'diaper' | 'poo' | 'bath' | 'sleep';  // Event type
  amount: number | null;               // Quantity (ml for milk, minutes for sleep)
  timestamp: string;                   // ISO 8601 timestamp (event recording time)
  user_name: string;                   // Caregiver who recorded the event
  subtype: string | null;              // Diaper subtype ('pee', 'poo', 'both')
  sleep_start_time: string | null;     // Sleep session start time (ISO)
  sleep_end_time: string | null;       // Sleep session end time (ISO)
  sleep_subtype: 'fall_asleep' | 'wake_up' | null;  // Sleep tracking type
}
```

### Baby Profile Object

```typescript
interface BabyProfile {
  id: number;
  name: string;
  date_of_birth: string;               // YYYY-MM-DD
  created_at: string;                  // ISO timestamp
  updated_at: string;                  // ISO timestamp
}
```

### Measurement Object

```typescript
interface BabyMeasurement {
  id: number;
  measurement_date: string;            // YYYY-MM-DD
  weight_kg: number | null;
  height_cm: number | null;
  head_circumference_cm: number | null;
  notes: string | null;
}
```

### AI Insights Object

```typescript
interface AIInsights {
  insights: Array<{
    title: string;
    description: string;
    type: 'feeding' | 'sleep' | 'diaper' | 'general';
    confidence: number;                // 0.0-1.0
    recommendation: string;
    whyItMatters: string;
    priority: number;                  // 1-5 (1 = highest)
  }>;
  alerts: Array<{
    title: string;
    severity: 'low' | 'medium' | 'high';
    note: string;
    priority: number;
  }>;
  miniPlan: {
    tonightBedtimeTarget: string;      // HH:mm format
    nextWakeWindows: string[];         // e.g., ["1h30m", "2h"]
    feedingNote: string;
  };
  measureOfSuccess: string;
}
```

---

## 🔍 Database Schema

```sql
-- Core event tracking table
CREATE TABLE baby_events (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  amount INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_name VARCHAR(50) NOT NULL,
  subtype VARCHAR(20),
  sleep_start_time TIMESTAMP,
  sleep_end_time TIMESTAMP,
  sleep_subtype VARCHAR(20)
);

-- Baby profile table
CREATE TABLE baby_profile (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Growth measurements table
CREATE TABLE baby_measurements (
  id SERIAL PRIMARY KEY,
  measurement_date DATE NOT NULL,
  weight_kg NUMERIC(4,2),
  height_cm NUMERIC(5,2),
  head_circumference_cm NUMERIC(4,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
- `baby_events(timestamp)` - For sorting and date-based queries
- `baby_events(type)` - For statistics aggregation
- `baby_events(user_name)` - For user-specific queries
- `baby_profile(date_of_birth)` - For age calculations
- `baby_measurements(measurement_date)` - For chronological retrieval

---

## 🚨 Security Considerations

- **HTTPS Enforcement**: All production endpoints require HTTPS
- **Input Validation**: Comprehensive validation on all parameters and request bodies
- **SQL Injection Prevention**: Parameterized queries via pg library
- **CORS Configuration**: Restricted to safe defaults
- **Rate Limiting**: Protection against abuse and DoS attacks
- **API Key Security**: DeepSeek API keys stored as environment variables, never in code
- **No Authentication**: Public API by design (caregiver allow-list via configuration)
- **Error Sanitization**: Error messages don't expose sensitive internal details

---

## 📝 Changelog

### v1.5.0 (Current)
- Installable PWA support (manifest, icons, service worker).

### v1.4.3
- Smart Alerts section hides when empty.
- "Add New Event" button moved to top.

### v1.4.2
- **DeepSeek insight quality upgrades**: Prompt now requires evidence‑grounded, actionable outputs; analyzer is more resilient to partial/messy responses.
- **Sleep data tooling upgrades**: Duplicate sleep sessions detected explicitly; overlap logic ignores boundary‑touching sessions.

### v1.4.1
- Modal-based event entry, improved UX flow, toast notifications, cleaner main interface.

### v1.4.0
- Various stability and performance improvements.

### v1.3.2
- **Enhanced Prompt Engineering**: Improved DeepSeek prompts with examples for consistent JSON responses
- **Dynamic Token Allocation**: Intelligent token budgeting based on data complexity (600-1200 tokens)
- **Cost Optimization**: Reduced token usage for small datasets without sacrificing quality
- **Better AI Response Structure**: More reliable JSON parsing with comprehensive examples

### v1.3.1
- **AI-Only Insights**: Adaptive Coach now exclusively uses DeepSeek AI
- **Removed Statistical Fallback**: Cleaner, focused AI-powered recommendations
- **Show 3 Insights**: Display up to 3 AI insights (was 2)

### v1.3.0
- **Simplified AI Refresh**: One-click AI insights refresh without token requirement
- **Streamlined UI**: Cleaner Adaptive Coach interface
- **DeepSeek AI Integration**: AI-powered analysis of sleep, feeding, and development patterns
- **Baby Profile**: Store baby's name, date of birth, and track growth measurements
- **Inline Profile Editing**: Edit profile directly with autosave
- **AI Retry Logic**: Automatic retries with exponential backoff for transient errors
- **Personalized Prompts**: AI analysis includes baby's name, age, and measurements

### v1.1.3
- **DeepSeek AI Integration**: Initial AI-powered pattern analysis
- **Baby Profile & Measurements**: New database tables for profile data

### v1.1.2
- **Unified Statistical Rigor**: Consistent z-score calculations across pattern analyzer

### v1.1.1
- **Pattern Analyzer Fixes**: Corrected improvement calculation and sample thresholds

### v1.1.0
- **Race condition fix**: Database transactions with row-level locking for sleep events
- **Overnight sleep tracking**: Sleep sessions spanning midnight display correctly
- **Query performance**: Stats queries use CTEs for bounded scans
- **Confirmation flow**: Unusual sleep durations trigger confirmation prompts

### v1.0.0
- **Initial API release**: Basic CRUD operations for events
- **Today's statistics endpoint**: Daily aggregation
- **Health check endpoint**: Basic API status

---

**Need Help?** Check the [main documentation](../README.md) or test the API directly using the examples above.
