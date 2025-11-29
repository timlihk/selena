# Baby Tracker

A web application to track newborn baby events including feeding, sleep, diapers, and baths. Features AI-powered insights via DeepSeek integration.

## Features

- **Event Tracking**: Log milk feedings, sleep sessions, diaper changes, and bath times
- **Multi-user Support**: Track events by caregiver name
- **Sleep Management**: Track sleep start/end times with overnight session support
- **Baby Profile**: Store baby's name, DOB, and growth measurements
- **AI-Powered Insights**: DeepSeek AI analyzes patterns and provides personalized recommendations
- **Adaptive Parenting Coach**: Combines statistical analysis with AI insights
- **Analytics Dashboard**: Daily stats, patterns, and timeline visualization
- **Mobile-friendly**: Responsive design for quick logging on any device
- **Timezone-aware**: Proper handling of local time across all features

## What's New

### v1.1.4
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

# Timezone
HOME_TIMEZONE=America/Los_Angeles

# DeepSeek AI (optional)
DEEPSEEK_API_KEY=sk-your-api-key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TEMPERATURE=0.3
DEEPSEEK_MAX_TOKENS=2000

# Server
PORT=3000
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
| GET | `/api/ai-insights` | Get AI-enhanced insights |
| GET | `/api/ai-insights?force=1` | Force refresh AI insights |
| GET | `/api/ai-insights/health` | Check DeepSeek API status |
| POST | `/api/ai-insights/refresh` | Manual refresh (requires token) |

## AI Features

The Adaptive Parenting Coach provides:

1. **Statistical Analysis** (always available)
   - Sleep pattern detection (best times, wake windows)
   - Feeding correlations
   - Z-score based confidence levels

2. **DeepSeek AI Analysis** (requires API key)
   - Personalized developmental insights
   - Age-appropriate recommendations
   - Feeding-to-sleep association detection
   - Growth milestone tracking
   - Alert detection for potential concerns

### AI Requirements
- Minimum 14 days of tracking data
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
