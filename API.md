# 🔌 API Documentation

Complete API reference for the Baby Event Tracker application.

**Base URL**: `https://selena.mangrove-hk.org`

All API endpoints return JSON responses and support CORS for cross-origin requests.

---

## 📋 API Overview

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|----------------|
| `GET` | `/api/events` | Get all events | None |
| `POST` | `/api/events` | Create new event | None |
| `DELETE` | `/api/events/:id` | Delete specific event | None |
| `GET` | `/api/stats/today` | Get today's statistics | None |
| `GET` | `/health` | Health check | None |

---

## 📊 Events Endpoints

### Get All Events

Retrieve all recorded baby events in reverse chronological order.

**Endpoint**: `GET /api/events`

**Response**:
```json
[
  {
    "id": 1,
    "type": "milk",
    "amount": 120,
    "timestamp": "2025-11-13T01:30:00.000Z"
  },
  {
    "id": 2,
    "type": "poo",
    "amount": null,
    "timestamp": "2025-11-13T01:15:00.000Z"
  }
]
```

**Status Codes**:
- `200` - Success
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
  "amount": 150
}
```

**Parameters**:

| Parameter | Type | Required | Description | Constraints |
|-----------|------|----------|-------------|-------------|
| `type` | string | ✅ | Event type | `milk`, `poo`, or `bath` |
| `amount` | integer | ❌ | Milk amount in ml | Required when type is `milk`, must be positive |

**Response**:
```json
{
  "id": 3,
  "type": "milk",
  "amount": 150,
  "timestamp": "2025-11-13T01:45:00.000Z"
}
```

**Status Codes**:
- `201` - Event created successfully
- `400` - Invalid request (missing type, invalid amount, etc.)
- `500` - Internal server error

**Validation Rules**:
- `type` must be one of: `milk`, `poo`, `bath`
- If `type` is `milk`, `amount` is required and must be > 0
- If `type` is `poo` or `bath`, `amount` is ignored

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

## 📈 Statistics Endpoints

### Get Today's Statistics

Retrieve aggregated statistics for today's events.

**Endpoint**: `GET /api/stats/today`

**Response**:
```json
{
  "milk": 3,
  "poo": 2,
  "bath": 1,
  "totalMilk": 420
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `milk` | integer | Number of milk events today |
| `poo` | integer | Number of diaper change events today |
| `bath` | integer | Number of bath events today |
| `totalMilk` | integer | Total milk consumed today (in ml) |

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
  "message": "Baby Tracker API is running"
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
  "error": "Error message describing what went wrong"
}
```

### Common Error Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| `400` | Bad Request | Invalid input, missing required fields |
| `404` | Not Found | Route not found, invalid endpoint |
| `500` | Internal Server Error | Database issues, unexpected errors |

### Example Error Responses

**Invalid Event Type**:
```json
{
  "error": "Invalid event type. Must be one of: milk, poo, bath"
}
```

**Missing Milk Amount**:
```json
{
  "error": "Milk amount is required and must be positive"
}
```

**Database Error**:
```json
{
  "error": "Failed to fetch events"
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
  -d '{"type": "milk", "amount": 120}'
```

**Create diaper change event**:
```bash
curl -X POST https://selena.mangrove-hk.org/api/events \
  -H "Content-Type: application/json" \
  -d '{"type": "poo"}'
```

**Get today's statistics**:
```bash
curl https://selena.mangrove-hk.org/api/stats/today
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
    amount: 150
  })
});

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
- **Headers**: Standard rate limit headers included

---

## 🌐 CORS Configuration

The API supports Cross-Origin Resource Sharing (CORS) with the following configuration:

- **Allowed Origins**: All origins (`*`)
- **Allowed Methods**: GET, POST, DELETE
- **Allowed Headers**: Content-Type
- **Credentials**: Not required

---

## 📊 Data Models

### Event Object

```typescript
interface Event {
  id: number;           // Auto-incrementing primary key
  type: 'milk' | 'poo' | 'bath';  // Event type
  amount: number | null;          // Milk amount (null for non-milk events)
  timestamp: string;    // ISO 8601 timestamp
}
```

### Statistics Object

```typescript
interface TodayStats {
  milk: number;        // Number of milk events today
  poo: number;         // Number of diaper changes today
  bath: number;        // Number of baths today
  totalMilk: number;   // Total milk consumed today (ml)
}
```

---

## 🔍 Database Schema

```sql
CREATE TABLE baby_events (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  amount INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
- `timestamp` (for sorting)
- `type` (for statistics)
- `date(timestamp)` (for daily queries)

---

## 🚨 Security Considerations

- All endpoints require HTTPS
- Input validation on all parameters
- SQL injection prevention via parameterized queries
- CORS configured for browser security
- Rate limiting to prevent abuse
- No authentication required (public API)

---

## 📝 Changelog

### v1.0.0 (Current)
- Initial API release
- Basic CRUD operations for events
- Today's statistics endpoint
- Health check endpoint

---

**Need Help?** Check the [main documentation](../README.md) or test the API directly using the examples above.