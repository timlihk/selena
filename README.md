# Baby Tracker

A web application to track newborn baby events including feeding, sleep, diapers, and baths. Features AI-powered insights via DeepSeek integration.

## Features

- **Event Tracking**: Log milk feedings, sleep sessions, diaper changes, and bath times via modal dialog
- **Multi-user Support**: Track events by caregiver name
- **Sleep Management**: Track sleep start/end times with overnight session support
- **Sleep Auto-Completion**: Active sleep sessions automatically complete when other events (milk, diaper, bath) are recorded, preventing overlaps
- **Baby Profile**: Store baby's name, DOB, and growth measurements
- **AI-Powered Insights**: DeepSeek AI analyzes patterns and provides personalized recommendations
- **Adaptive Parenting Coach**: Combines statistical analysis with AI insights
- **Analytics Dashboard**: Daily stats, patterns, and timeline visualization
- **Mobile-friendly**: Responsive design for quick logging on any device
- **Timezone-aware**: Proper handling of local time across all features

## What's New

### v1.5.11 (Latest)
- **UI Polish**: Enhanced action plan card styling with gradient background and branded border color.

### v1.5.10
- **Dark Mode Fix**: Added missing `--card-bg` and `--card-border` CSS variables for proper dark mode contrast.

### v1.5.9
- **AI Enhancements**: Action plans, schedule suggestions, alert explanations, grounded Q&A with rate-limit and cache.
- **Sleep Accuracy**: Sleep minutes are clamped to day boundaries to handle cross-midnight sessions.
- **UI Resilience**: Dark-mode tweaks for AI cards and safer analytics fallbacks; auto-refresh every 10 minutes (skips if modal open or hidden).

### v1.5.0
- **Installable PWA**: Added web manifest, app icons, and offline app‑shell caching via service worker.

### v1.4.3
- **Smart Alerts visibility**: Alerts section now hides when there are no active alerts.
- **Primary action placement**: "Add New Event" button moved to the top for faster access.

### v1.4.2
- **Deeper, more reliable DeepSeek insights**: Improved prompt grounding, larger default response budget, stronger retries, and robust JSON extraction/validation.
- **Sleep anomaly scanner improvements**: Now reports exact duplicates separately and avoids false “overlap” flags when sessions touch at boundaries.

### v1.4.1
- **Modal-based Event Entry**: Replaced inline event form with a prominent "Add New Event" button
- **Improved UX Flow**: Click button to open modal, form auto-closes on successful submission
- **Toast Notifications**: Success messages displayed after adding events
- **Cleaner Main Interface**: Reduced visual clutter on the main page

### v1.4.0
- Various stability and performance improvements

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

## Requirements

- Node.js >= 18.0.0
- PostgreSQL (optional - falls back to in-memory store for development)
- DeepSeek API key (optional - for AI insights)

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file with:

```bash
# Required
DATABASE_URL=postgresql://user:password@host:port/database

# Timezone (default: Asia/Hong_Kong)
BABY_HOME_TIMEZONE=Asia/Hong_Kong

# DeepSeek AI (optional)
DEEPSEEK_API_KEY=sk-your-api-key-from-platform.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TEMPERATURE=0.1
DEEPSEEK_MAX_TOKENS=1000  # If not set, dynamic allocation (600-1200) based on data complexity
DEEPSEEK_LOOKBACK_DAYS=30  # How many days of data to analyze
DEEPSEEK_REFRESH_TOKEN=your-manual-refresh-token  # For manual refresh endpoint

# Server
PORT=3000
NODE_ENV=development  # or production
DEFAULT_BABY_AGE_WEEKS=8  # Fallback age if no profile exists

# Rate limiting (optional)
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100
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

## PWA (Installable App)

Baby Tracker now includes basic Progressive Web App support:
- Installable from Chrome/Edge/Safari (Add to Home Screen).
- Offline app shell caching via service worker.

Notes:
- The included icons are SVG placeholders. Replace with PNGs (`192x192`, `512x512`, and a maskable variant) for best cross‑platform support, especially iOS.

## API Endpoints

### Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | List all events |
| POST | `/api/events` | Create new event |
| DELETE | `/api/events/:id` | Delete an event |
| GET | `/api/stats` | Get today's statistics |
| POST | `/api/events/confirmed-sleep` | Create sleep bypassing validation |

### Baby Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/baby-profile` | Get baby profile and measurements |
| POST | `/api/baby-profile` | Create/update baby profile |
| POST | `/api/baby-profile/measurements` | Add new measurement |
| GET | `/api/baby-profile/measurements` | Get all measurements |

### AI Insights
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-insights` | Get AI-enhanced insights with action plans and schedule |
| GET | `/api/ai-insights?force=1` | Force refresh AI insights |
| GET | `/api/ai-insights/health` | Check DeepSeek API status |
| GET | `/api/ai-insights/ask?q=...` | Ask a question about your data |
| POST | `/api/ai-insights/refresh` | Manual refresh (requires token) |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/today` | Get today's feeding, sleep, diaper analytics with weekly trends |

## AI Features

The Adaptive Parenting Coach provides:

1. **Statistical Analysis** (always available)
   - Sleep pattern detection (best times, wake windows)
   - Feeding correlations
   - Week-over-week trend indicators (↑↓→)
   - Z-score based confidence levels

2. **DeepSeek AI Analysis** (requires API key)
   - Personalized developmental insights
   - Age-appropriate recommendations
   - Feeding-to-sleep association detection
   - Growth milestone tracking
   - Alert detection for potential concerns

3. **Action Plans** (AI-powered)
   - Prioritized action items extracted from insights
   - Tonight's bedtime target and wake windows
   - Concrete steps with priority levels (P1-P5)

4. **Ask AI** (Q&A feature)
   - Ask questions like "How were naps this week?"
   - Grounded answers using only your actual data
   - Concise responses (≤120 words) with concrete numbers

### AI Requirements
- Minimum 10 days of tracking data for AI insights
- Minimum 14 days for week-over-week trends
- Valid `DEEPSEEK_API_KEY` environment variable
- Active DeepSeek account with credits

## Database Schema

### baby_events
Core event tracking table with sleep session support.

### baby_profile
Stores baby's name and date of birth.

### baby_measurements
Tracks weight, height, and head circumference over time.

## Deployment

Deployed via Railway with auto-deploy on push to master.

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for development guidelines.

## API Documentation

See [API.md](API.md) for complete API reference.

## License

MIT
