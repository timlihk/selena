# Baby Tracker - Claude Code Context

## Project Overview
A web application to track newborn baby events (feeding, sleep, diapers, baths) with AI-powered insights. Deployed on Railway with PostgreSQL.

**Current Version**: 1.4.1 (Modal-based event entry UI)

### Recent Enhancements (v1.4.1)
- **Modal-based Event Entry**: Replaced inline form with a prominent "Add New Event" button that opens a modal dialog
- **Improved UX**: Form auto-closes on success with toast notification
- **Cleaner UI**: Main page now shows just the button, reducing visual clutter

### Previous Updates (v1.3.2)
- **Enhanced Prompt Engineering**: Comprehensive JSON schema examples for consistent AI responses
- **Dynamic Token Allocation**: Intelligent token budgeting (600-1200 tokens) based on data complexity
- **Cost Optimization**: Reduced token usage for small datasets without sacrificing quality
- **Better AI Response Structure**: Reliable JSON parsing with markdown stripping
- **Centralized Configuration**: All settings in `config.js` (timezone, validation, AI parameters)

### Core Features
- Event tracking (milk, sleep, diaper, bath) with multi-user support
- **Modal-based event entry** with prominent "Add New Event" button
- Baby profile with age calculation and growth measurements
- AI-powered insights via DeepSeek API (minimum 10 days data)
- Real-time sleep session tracking with overnight support
- 24-hour timeline visualization with responsive design
- Dark mode support with system preference detection
- Statistical pattern analysis (z-scores) + AI-enhanced insights

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
- `public/index.html` - Single-page UI with modals (Add Event modal, Baby Profile modal)
- `public/script.js` - BabyTracker class, event handling, modal management, AI insights rendering
- `public/styles.css` - Responsive styles, dark mode support, modal styles
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
DATABASE_URL           # PostgreSQL connection string (in-memory fallback if not set)

# Timezone
BABY_HOME_TIMEZONE     # Default: Asia/Hong_Kong (used for date boundaries)

# DeepSeek AI (optional - enables AI insights)
DEEPSEEK_API_KEY       # API key from platform.deepseek.com
DEEPSEEK_MODEL         # Default: deepseek-chat
DEEPSEEK_TEMPERATURE   # Default: 0.1 (low for consistent medical advice)
DEEPSEEK_MAX_TOKENS    # Default: 1000 (dynamic allocation 600-1200 used if not set)
DEEPSEEK_LOOKBACK_DAYS # Default: 30 (how many days of data to analyze)
DEEPSEEK_REFRESH_TOKEN # For manual refresh endpoint (optional)

# Server
PORT                   # Default: 3000
NODE_ENV               # development or production
DEFAULT_BABY_AGE_WEEKS # Fallback age if no profile (default: 8)

# All configuration centralized in config.js
```

## API Endpoints

### Events
- `GET /api/events` - List events (filterable by type & JSON filter)
- `POST /api/events` - Create new event (milk, diaper, sleep, bath)
- `PUT /api/events/:id` - Update existing event
- `DELETE /api/events/:id` - Delete event
- `POST /api/events/confirmed-sleep` - Create sleep bypassing duration validation

### Sleep
- `GET /api/sleep/active` - Get active (incomplete) sleep sessions

### Statistics
- `GET /api/stats/today` - Get today's aggregated statistics

### Baby Profile
- `GET /api/baby-profile` - Get profile with age calculation & latest measurement
- `POST /api/baby-profile` - Create/update profile (name, date_of_birth)

### Baby Measurements
- `GET /api/baby-measurements` - Get all growth measurements
- `POST /api/baby-measurements` - Add new measurement

### AI Insights
- `GET /api/ai-insights` - Get AI-enhanced insights (cached 23 hours)
- `GET /api/ai-insights?force=1` - Force regenerate insights
- `GET /api/ai-insights/health` - Check DeepSeek API status
- `POST /api/ai-insights/refresh` - Manual refresh (requires X-Refresh-Token header)

### Configuration & Health
- `GET /api/config` - Get server configuration (timezone, allowed users, etc.)
- `GET /health` - Health check endpoint
- `GET /` - Serve frontend application

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

### AI Insights Flow (Enhanced v1.3.2)
1. `GET /api/ai-insights` checks cache (23-hour TTL, invalidates after 5 new events)
2. If stale/forced → `generateAndCacheInsights()` called with optional goal/concerns
3. Loads events (with 30-day lookback), profile, latest measurement
4. `DeepSeekEnhancedAnalyzer.extractStatisticalPatterns()` computes feeding-to-sleep, wake windows, distribution patterns
5. **Enhanced Prompt Engineering**: Builds context with baby profile, age-based norms, 7-day trends, statistical patterns
6. **Dynamic Token Allocation**: Calculates optimal max_tokens (600-1200) based on data complexity
7. Calls DeepSeek API with exponential backoff retry logic (2 retries)
8. Parses JSON response (strips markdown code blocks, enforces JSON schema)
9. Returns combined statistical patterns + AI-enhanced insights

### Key Classes
- `BabyTracker` (script.js) - Main frontend controller, timeline rendering, event handling, modal management
  - `showAddEventModal()` / `hideAddEventModal()` - Add Event modal controls
  - `showBabyProfileModal()` / `hideBabyProfileModal()` - Baby Profile modal controls
- `PatternAnalyzer` (pattern_analyzer.js) - Client-side statistical z-score analysis
- `DeepSeekEnhancedAnalyzer` (deepseek_analyzer.js) - AI integration with enhanced prompt engineering
- `PatternDetector` (deepseek_analyzer.js) - Real-time anomaly detection (feeding gaps, low sleep, etc.)
- `BabyProfile`, `Event` (database.js) - Database models with in-memory fallback

### Centralized Configuration
- `config.js` - Single source for all environment variables, validation constants, allowed values
- Timezone handling via `BABY_HOME_TIMEZONE` (default: Asia/Hong_Kong)
- AI settings: model, temperature (0.1), token allocation, lookback days
- Validation: max milk amount (500ml), max sleep duration (480min), measurement ranges

### Sleep Session Handling
- Sleep sessions can span midnight (overnight tracking)
- Uses `sleep_start_time` and `sleep_end_time` columns
- Row-level locking prevents duplicate concurrent events
- **Auto-completion**: When a new non-sleep event is recorded, any active sleep session for that user is automatically completed (ended) with the new event's timestamp
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
1. Check API key status: `GET /api/ai-insights/health`
2. Force refresh: `GET /api/ai-insights?force=1` (bypasses 23-hour cache)
3. Manual refresh (with token): `POST /api/ai-insights/refresh` + `X-Refresh-Token` header
4. Check Railway logs for `[DeepSeek]` prefixed messages (token usage, errors)
5. Verify minimum data: 10+ days for AI insights, 14+ days for statistical confidence
6. Check `config.js` for correct DEEPSEEK configuration values
7. Test token allocation logic: Small datasets (600-800 tokens), medium (800-1000), large (1000-1200)
