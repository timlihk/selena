# Baby Tracker

A simple web application to track newborn baby events including feeding, sleep, diapers, and baths.

## Features

- **Event Tracking**: Log milk feedings, sleep sessions, diaper changes, and bath times
- **Multi-user Support**: Track events by caregiver name
- **Sleep Management**: Track sleep start/end times with overnight session support
- **Analytics Dashboard**: Daily stats, patterns, and timeline visualization
- **Mobile-friendly**: Responsive design for quick logging on any device
- **Timezone-aware**: Proper handling of local time across all features

## v1.1.0 Changes

- **Race condition fix**: Sleep session creation now uses database transactions with row-level locking to prevent duplicate concurrent "fall asleep" events
- **Overnight sleep tracking**: Sleep sessions spanning midnight now appear correctly in daily stats and timeline views
- **Shared overlap logic**: Unified `eventOverlapsRange` helper ensures consistent sleep filtering across memory store, database, and client
- **Query performance**: Stats queries now use a CTE to bound scans to a 1-day window instead of full table scans
- **Confirmation flow**: Unusual sleep durations trigger a 422 response with confirmation prompt before recording

## Requirements

- Node.js >= 18.0.0
- PostgreSQL (optional - falls back to in-memory store for development)

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file with:

```
DATABASE_URL=postgresql://user:password@host:port/database
HOME_TIMEZONE=America/Los_Angeles
```

## Running

```bash
# Production
npm start

# Development
npm run dev

# Tests
npm test
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | List all events |
| POST | `/api/events` | Create new event |
| DELETE | `/api/events/:id` | Delete an event |
| GET | `/api/stats` | Get today's statistics |
| POST | `/api/events/confirmed-sleep` | Create sleep event bypassing duration validation |

## License

MIT
