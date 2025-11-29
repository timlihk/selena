# Baby Tracker - Claude Code Context

## Project Overview
A web application to track newborn baby events (feeding, sleep, diapers, baths) with AI-powered insights. Deployed on Railway with PostgreSQL.

**Current Version**: 1.3.1

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Railway) with in-memory fallback for dev
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **AI**: DeepSeek API for pattern analysis
- **Deployment**: Railway (auto-deploy on push to master)

## Key Files

### Backend
- `server.js` - Express server, API routes, AI insights orchestration
- `database.js` - PostgreSQL queries, BabyProfile model, in-memory fallback
- `deepseek_analyzer.js` - DeepSeek AI integration, pattern extraction, prompt building

### Frontend
- `public/index.html` - Single-page UI with modals
- `public/script.js` - BabyTracker class, event handling, AI insights rendering
- `public/styles.css` - Responsive styles, dark mode support
- `public/pattern_analyzer.js` - Client-side statistical analysis (z-scores)

### Tests
- `tests/run-tests.js` - Test suite

## Common Commands
```bash
npm start              # Start server (PORT=3000 default)
npm test               # Run tests
npm run dev            # Development mode
railway logs           # View deployment logs
railway variables      # View/set environment variables
```

## Environment Variables
```bash
# Required
DATABASE_URL           # PostgreSQL connection string

# Timezone
HOME_TIMEZONE          # Default: America/Los_Angeles

# DeepSeek AI (optional)
DEEPSEEK_API_KEY       # API key from platform.deepseek.com
DEEPSEEK_MODEL         # Default: deepseek-chat
DEEPSEEK_TEMPERATURE   # Default: 0.3
DEEPSEEK_MAX_TOKENS    # Default: 2000
DEEPSEEK_REFRESH_TOKEN # For manual refresh endpoint

# Server
PORT                   # Default: 3000
DEFAULT_BABY_AGE_WEEKS # Fallback age if no profile
```

## API Endpoints

### Events
- `GET /api/events` - List events
- `POST /api/events` - Create event
- `DELETE /api/events/:id` - Delete event
- `GET /api/stats` - Daily statistics
- `POST /api/events/confirmed-sleep` - Create sleep bypassing validation

### Baby Profile
- `GET /api/baby-profile` - Get profile with age calculation
- `POST /api/baby-profile` - Create/update profile (name, DOB)
- `POST /api/baby-profile/measurements` - Add measurement
- `GET /api/baby-profile/measurements` - Get all measurements

### AI Insights
- `GET /api/ai-insights` - Get cached AI insights
- `GET /api/ai-insights?force=1` - Force regenerate
- `GET /api/ai-insights/health` - Check DeepSeek API status
- `POST /api/ai-insights/refresh` - Manual refresh (requires X-Refresh-Token header)

## Database Schema

### baby_events
```sql
id, type, amount, timestamp, user_name, subtype,
sleep_start_time, sleep_end_time, sleep_subtype
```

### baby_profile
```sql
id, name, date_of_birth, created_at, updated_at
```

### baby_measurements
```sql
id, measurement_date, weight_kg, height_cm, head_circumference_cm, notes
```

## Architecture Notes

### AI Insights Flow
1. `GET /api/ai-insights` checks cache (6hr TTL)
2. If stale → `generateAndCacheInsights()` called
3. Loads events, profile, measurements
4. `DeepSeekEnhancedAnalyzer` extracts statistical patterns
5. Builds prompt with baby context
6. Calls DeepSeek API (with retry logic)
7. Parses JSON response (strips markdown blocks)
8. Returns combined statistical + AI insights

### Key Classes
- `BabyTracker` (script.js) - Main frontend controller
- `PatternAnalyzer` (pattern_analyzer.js) - Statistical z-score analysis
- `DeepSeekEnhancedAnalyzer` (deepseek_analyzer.js) - AI integration

### Sleep Session Handling
- Sleep sessions can span midnight (overnight tracking)
- Uses `sleep_start_time` and `sleep_end_time` columns
- Row-level locking prevents duplicate concurrent events
- `eventOverlapsRange()` helper for consistent filtering

### Timezone Handling
- All times stored as UTC in database
- `HOME_TIMEZONE` used for date boundary calculations
- Frontend converts to local time for display

## Testing
```bash
npm test                    # Run all tests
node tests/run-tests.js     # Direct test execution
```

## Deployment
```bash
git push origin master      # Triggers Railway auto-deploy
railway logs                # View deployment logs
railway variables set KEY=value  # Set environment variable
```

## Debugging AI Issues
1. Check API key: `GET /api/ai-insights/health`
2. Force refresh: `GET /api/ai-insights?force=1`
3. Check Railway logs for `[DeepSeek]` prefixed messages
4. Verify 14+ days of data exists
