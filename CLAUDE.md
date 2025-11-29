# Baby Tracker - Claude Code Context

## Project Overview
A web application to track newborn baby events (feeding, sleep, diapers, baths). Deployed on Railway with PostgreSQL.

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Railway) with in-memory fallback for dev
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Deployment**: Railway

## Key Files
- `server.js` - Express server, API routes
- `database.js` - PostgreSQL queries, in-memory store fallback
- `public/script.js` - Client-side logic
- `public/index.html` - Single-page UI
- `tests/run-tests.js` - Test suite

## Common Commands
```bash
npm start          # Start server (PORT=3000 default)
npm test           # Run tests
npm run dev        # Development mode
railway logs       # View deployment logs
```

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `HOME_TIMEZONE` - Timezone for date calculations (default: America/Los_Angeles)
- `PORT` - Server port (default: 3000)

## API Endpoints
- `GET /api/events` - List events
- `POST /api/events` - Create event
- `DELETE /api/events/:id` - Delete event
- `GET /api/stats` - Daily statistics
- `POST /api/events/confirmed-sleep` - Create sleep bypassing validation

## Architecture Notes
- Sleep sessions can span midnight (overnight tracking)
- Database uses row-level locking for concurrent sleep events
- Stats queries use CTEs for performance
- Timezone handling is critical - all times stored as UTC

## Testing
Tests are in `tests/` directory. Run with `npm test`.

## Deployment
Deployed via Railway. Config in `railway.json`.
Push to master triggers auto-deploy.
