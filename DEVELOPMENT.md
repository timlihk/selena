# 🛠️ Development Guide

Complete development guide for the Baby Event Tracker application.

---

## 📋 Overview

This guide covers:
- Local development setup
- Code architecture and structure
- Adding new features
- Testing and debugging
- Code standards and best practices

---

## 1. 🏗️ Project Architecture

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | User interface and interactions |
| **Backend** | Node.js, Express.js | API server and routing |
| **Database** | PostgreSQL | Data persistence |
| **Build Tool** | NPM | Dependency management |
| **Deployment** | Railway.app | Cloud hosting |

### File Structure

```
selena/
├── public/                # Frontend files (served statically)
│   ├── 📄 index.html      # Main HTML entry point
│   ├── 🎨 styles.css      # Complete CSS with dark mode & responsive design
│   └── ⚡ script.js       # Frontend JavaScript with timeline visualization
├── tests/                 # Test files
│   └── 🧪 run-tests.js    # Automated test suite
├── 🖥️ server.js           # Express.js server with API endpoints
├── 🗄️ database.js         # Database configuration and models
├── 📦 package.json        # Dependencies and scripts
├── 🚄 railway.json        # Railway deployment configuration
├── 🔧 .env.example        # Environment variables template
├── 📚 README.md           # Main documentation
├── 📋 API.md              # API documentation
├── 🚀 DEPLOYMENT.md       # Deployment guide
└── 🛠️ DEVELOPMENT.md      # This development guide
```

---

## 2. 🚀 Local Development Setup

### Prerequisites

- Node.js 14+
- PostgreSQL 12+
- Git

### Step 1: Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd selena

# Install dependencies
npm install
```

### Step 2: Database Setup

#### Option A: Local PostgreSQL

1. **Install PostgreSQL**
   - macOS: `brew install postgresql`
   - Ubuntu: `sudo apt install postgresql postgresql-contrib`
   - Windows: Download from postgresql.org

2. **Create Database**
   ```bash
   # Connect to PostgreSQL
   psql postgres

   # Create database and user
   CREATE DATABASE baby_tracker;
   CREATE USER baby_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE baby_tracker TO baby_user;
   ```

#### Option B: Docker PostgreSQL

```bash
# Run PostgreSQL in Docker
docker run --name baby-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=baby_tracker -p 5432:5432 -d postgres:13
```

### Step 3: Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit .env file
DATABASE_URL=postgresql://baby_user:password@localhost:5432/baby_tracker
NODE_ENV=development
PORT=3000
```

### Step 4: Start Development Server

```bash
# Start the application
npm run dev

# Or start manually
node server.js
```

Visit: http://localhost:3000

---

## 3. 🔧 Code Structure

### Frontend Architecture (`public/script.js`)

#### Configuration Constants

```javascript
// Event type configuration (lines 3-44)
const EVENT_CONFIG = {
  milk: {
    icon: '🍼',
    label: 'Milk',
    color: '#4299e1',
    requiresAmount: true,
    maxAmount: 500
  },
  diaper: {
    icon: '💩',
    label: 'Diaper',
    color: '#48bb78',
    subtypes: ['pee', 'poo', 'both']
  },
  // ... other event types
};

// UI and validation constants
const UI_CONSTANTS = { TIMELINE_HOURS: 24, /* ... */ };
const VALIDATION = { /* validation rules */ };
```

#### BabyTracker Class

```javascript
class BabyTracker {
  constructor() {
    this.events = [];
    this.activeTimelineMarker = null; // For touch-friendly tooltips
    this.init();
  }

  async init() {
    this.initializeTheme(); // Dark mode setup
    this.bindEvents();
    await this.loadEvents();
    await this.updateStats();
    this.renderTimeline(); // 24-hour timeline visualization
  }

  // Event handling
  bindEvents() { /* ... */ }

  // API communication
  async addEvent() { /* ... */ }
  async loadEvents() { /* ... */ }
  async updateStats() { /* ... */ }

  // UI rendering
  renderEvents() { /* ... */ }
  createEventHTML(event) { /* ... */ }
  renderTimeline() { /* Horizontal 24-hour timeline */ }

  // Theme management
  initializeTheme() { /* Dark mode toggle */ }
  toggleTheme() { /* Switch between light/dark */ }
}
```

#### Key Methods

- `bindEvents()` - Sets up event listeners (including touch events for mobile)
- `addEvent()` - Handles form submission with loading states
- `loadEvents()` - Fetches events from API
- `updateStats()` - Updates statistics display
- `renderEvents()` - Renders events list with inline edit capability
- `renderTimeline()` - Creates horizontal 24-hour timeline with event markers
- `initializeTheme()` - Sets up dark mode from localStorage or system preference
- `toggleTheme()` - Switches between light and dark themes

#### Timeline Architecture

The timeline renders a horizontal 24-hour visualization (00:00 to 24:00) with:
- **Hour ruler**: Displays time markers at 6-hour intervals
- **Event lanes**: One lane per event type (milk, diaper, bath, sleep)
- **Event markers**: Positioned at their actual times with tooltips
- **Responsive layout**:
  - Desktop (>768px): 56px icon column, 24px right margin
  - Tablet (≤768px): 56px icon column, 16px right margin
  - Mobile (≤480px): 48px icon column, 12px right margin

### Pattern Analyzer Architecture (`public/pattern_analyzer.js`) NEW!

**NEW FEATURE: Adaptive Parenting Coach**

The PatternAnalyzer provides AI-powered pattern recognition that learns from your baby's actual behavior patterns (not generic advice).

#### PatternAnalyzer Class

```javascript
class PatternAnalyzer {
  constructor(events, timezone) {
    this.events = events;
    this.timezone = timezone;
    this.minDataDays = 14; // Minimum threshold for reliable insights
  }

  // Core analysis methods
  analyzeFeedingToSleep()      // Feeding → Sleep correlation
  analyzeWakeWindows()         // Wake window → Sleep duration

  // Utility methods
  hasSufficientData()          // Check if 14+ days of data
  getDaysOfData()              // Calculate data range
  generateInsights()           // Generate all actionable insights
}
```

#### How It Works

**Feeding-to-Sleep Analysis:**
1. Identifies feeding events within 4 hours of sleep
2. Groups by feeding hour (e.g., 19:00)
3. Calculates average following sleep duration
4. Suggests optimal feeding window when improvement > 15 minutes

**Wake Window Analysis:**
1. Tracks gaps between sleep sessions
2. Analyzes in 30-minute buckets (1-6 hour range)
3. Finds window with longest following sleep
4. Recommends optimal wake duration

**Confidence Algorithm:**
```javascript
confidence = Math.min(dataPoints / 10, maxConfidence)
// More data points = higher confidence (capped at 85-90%)
// Minimum 14 days required before showing insights
```

**Example Output:**
```javascript
{
  type: 'feeding_to_sleep',
  title: 'Optimal Feeding Window Found',
  description: 'Based on 12 feeding sessions, feeding around 7:00 PM leads to 23 minutes longer sleep.',
  recommendation: 'Try feeding around 7:00 PM for better sleep sessions.',
  confidence: 0.90,  // 90% confidence
  dataPoints: 12
}
```

#### Integration Points

- **Initialization**: Created in `BabyTracker.updateAdaptiveCoach()` (line 1011)
- **Trigger**: Called automatically after every `updateStats()` (line 589)
- **Display**: Renders in new Adaptive Coach panel in Smart Insights
- **Real-time**: Recalculates whenever events change

#### Extending the Analyzer

**Adding New Analysis Type:**

```javascript
// 1. Add analysis method to PatternAnalyzer class
analyzeBedtimeConsistency() {
  const insights = [];
  // ... analysis logic for bedtime consistency
  return insights;
}

// 2. Add to main generator
class PatternAnalyzer {
  generateInsights() {
    const insights = [];
    insights.push(...this.analyzeFeedingToSleep());
    insights.push(...this.analyzeWakeWindows());
    insights.push(...this.analyzeBedtimeConsistency()); // NEW
    return insights;
  }
}

// 3. Update BabyTracker to handle new insight type
updateAdaptiveCoach() {
  const analyzer = new PatternAnalyzer(this.events, this.homeTimezone);
  const insights = analyzer.generateInsights();
  // ... render logic includes new type
}
```

**Future Extension Ideas:**
- Bedtime consistency → Sleep duration
- Napping location → Sleep quality
- Feeding amount → Sleep duration
- Growth spurt detection (feeding increases)
- Teething pattern recognition (sleep disruption + mood changes)
- Seasonal/weather correlations
- Caregiver effect on baby behavior

### Backend Architecture (`server.js`)

#### Express Server Setup

```javascript
const express = require('express');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(process.cwd()));

// API Routes
app.get('/api/events', async (req, res) => { /* ... */ });
app.post('/api/events', async (req, res) => { /* ... */ });
app.get('/api/stats/today', async (req, res) => { /* ... */ });
app.delete('/api/events/:id', async (req, res) => { /* ... */ });

// Static routes
app.get('/', (req, res) => { /* ... */ });
app.get('/health', (req, res) => { /* ... */ });
```

#### Route Patterns

All API routes follow this pattern:

```javascript
app.METHOD('/api/endpoint', async (req, res) => {
  try {
    // Business logic
    const result = await databaseOperation();
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});
```

### Database Layer (`database.js`)

#### Connection Pool

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

#### Event Model

```javascript
const Event = {
  async getAll() {
    const result = await pool.query('SELECT * FROM baby_events ORDER BY timestamp DESC');
    return result.rows;
  },

  async create(type, amount = null) {
    const result = await pool.query(
      'INSERT INTO baby_events (type, amount) VALUES ($1, $2) RETURNING *',
      [type, amount]
    );
    return result.rows[0];
  },

  // ... other methods
};
```

---

## 4. 🎯 Adding New Features

### Step 1: Plan the Feature

1. **Define Requirements**: What problem does it solve?
2. **Design Data Model**: What database changes are needed?
3. **Plan API**: What endpoints are required?
4. **Design UI**: How will users interact with it?

### Step 2: Database Changes

#### Add New Table (if needed)

```sql
-- Add to database initialization in database.js
CREATE TABLE IF NOT EXISTS new_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Modify Existing Table

```sql
ALTER TABLE baby_events ADD COLUMN new_column VARCHAR(50);
```

### Step 3: Backend API

#### Add New Endpoint

```javascript
// In server.js
app.post('/api/new-endpoint', async (req, res) => {
  try {
    const { data } = req.body;

    // Validation
    if (!data) {
      return res.status(400).json({ error: 'Data is required' });
    }

    // Business logic
    const result = await Event.createNew(data);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating new item:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
});
```

#### Add Database Method

```javascript
// In database.js
const Event = {
  // ... existing methods

  async createNew(data) {
    const result = await pool.query(
      'INSERT INTO new_table (name) VALUES ($1) RETURNING *',
      [data.name]
    );
    return result.rows[0];
  }
};
```

### Step 4: Frontend Integration

#### Add UI Elements

```html
<!-- In index.html -->
<div class="new-feature-section">
  <h2>New Feature</h2>
  <form id="newFeatureForm">
    <input type="text" id="newInput" placeholder="Enter data">
    <button type="submit">Add</button>
  </form>
</div>
```

#### Add JavaScript Logic

```javascript
// In script.js - BabyTracker class
class BabyTracker {
  // ... existing methods

  bindEvents() {
    // ... existing event bindings

    // New feature event binding
    const newForm = document.getElementById('newFeatureForm');
    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleNewFeature();
    });
  }

  async handleNewFeature() {
    const input = document.getElementById('newInput').value;

    try {
      const response = await fetch('/api/new-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: input })
      });

      if (!response.ok) {
        throw new Error('Failed to add new feature');
      }

      // Update UI
      this.resetNewForm();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to add new feature: ' + error.message);
    }
  }

  resetNewForm() {
    document.getElementById('newFeatureForm').reset();
  }
}
```

#### Add Styling

```css
/* In styles.css */
.new-feature-section {
  background: white;
  border-radius: 15px;
  padding: 30px;
  margin-bottom: 30px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.1);
}

.new-feature-section h2 {
  color: #4a5568;
  margin-bottom: 20px;
}
```

---

## 5. 🧪 Testing

### Manual Testing Checklist

#### Functionality Tests
- [ ] Add events of all types
- [ ] Verify event list updates
- [ ] Check statistics calculation
- [ ] Test form validation
- [ ] Verify error handling
- [ ] Test on different screen sizes

#### API Tests

```bash
# Test all endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/events
curl -X POST http://localhost:3000/api/events -H "Content-Type: application/json" -d '{"type":"milk","amount":120}'
curl -X DELETE http://localhost:3000/api/events/1
curl http://localhost:3000/api/stats/today
```

#### Browser Testing
- [ ] Chrome, Firefox, Safari
- [ ] Mobile browsers
- [ ] Tablet devices
- [ ] Different screen orientations

### Automated Testing (Future Enhancement)

Consider adding:
- Unit tests with Jest
- Integration tests with Supertest
- End-to-end tests with Playwright

---

## 6. 🐛 Debugging

### Common Issues

#### Database Connection Issues

**Symptoms**: "Connection refused" errors
**Solutions**:
- Check PostgreSQL is running: `pg_isready`
- Verify connection string in `.env`
- Check firewall settings

#### CORS Errors

**Symptoms**: "Blocked by CORS policy" in browser console
**Solutions**:
- Verify CORS middleware is configured
- Check allowed origins
- Test with different browsers

#### Static File Issues

**Symptoms**: 404 errors for CSS/JS files
**Solutions**:
- Check static file path in Express
- Verify file permissions
- Check case sensitivity

### Debugging Tools

#### Console Logging

```javascript
// Add strategic console logs
console.log('Database URL:', process.env.DATABASE_URL);
console.log('Events count:', events.length);
console.error('API Error:', error);
```

#### Browser DevTools

- **Network tab**: Monitor API requests
- **Console tab**: JavaScript errors and logs
- **Elements tab**: Inspect HTML structure
- **Application tab**: Check storage and service workers

#### Database Debugging

```bash
# Connect to database
psql $DATABASE_URL

# Check tables
\dt

# Query data
SELECT * FROM baby_events ORDER BY timestamp DESC LIMIT 10;
```

---

## 7. 📝 Code Standards

### JavaScript Standards

#### Naming Conventions

```javascript
// Variables and functions - camelCase
const eventList = document.getElementById('eventsList');
async function loadEvents() { /* ... */ }

// Classes - PascalCase
class BabyTracker { /* ... */ }

// Constants - UPPER_SNAKE_CASE
const ALLOWED_EVENT_TYPES = ['milk', 'poo', 'bath'];
```

#### Error Handling

```javascript
// Always use try-catch for async operations
async function apiCall() {
  try {
    const response = await fetch('/api/endpoint');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error; // Re-throw for caller to handle
  }
}
```

#### Code Organization

```javascript
// Group related functionality
class BabyTracker {
  // Constructor and initialization
  constructor() { /* ... */ }

  // Event handling
  bindEvents() { /* ... */ }

  // API communication
  async apiMethod() { /* ... */ }

  // UI rendering
  renderMethod() { /* ... */ }
}
```

### CSS Standards

#### Organization

```css
/* 1. CSS Variables for theming */
:root {
  --bg-primary: #f0f4f8;
  --text-primary: #1a202c;
  --accent-primary: #667eea;
  /* ... */
}

/* 2. Dark mode variables */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a202c;
    --text-primary: #f7fafc;
    /* ... */
  }
}

/* 3. Reset and base styles */
* { /* ... */ }

/* 4. Layout components */
.container { /* ... */ }

/* 5. Timeline components */
.timeline-hours { /* ... */ }
.timeline-lane { /* ... */ }

/* 6. Responsive design */
@media (max-width: 768px) { /* Tablet */ }
@media (max-width: 480px) { /* Mobile */ }
```

#### Responsive Breakpoints

The application uses two primary breakpoints:

| Breakpoint | Screen Width | Target Devices | Key Changes |
|------------|--------------|----------------|-------------|
| **Desktop** | > 768px | Desktops, laptops | 56px icon column, full spacing |
| **Tablet** | ≤ 768px | Tablets, small laptops | 56px icon column, reduced margins |
| **Mobile** | ≤ 480px | Smartphones | 48px icon column, compact layout |

#### Dark Mode Implementation

- CSS variables for all colors (enables easy theme switching)
- `prefers-color-scheme` media query for system preference detection
- `data-theme` attribute on `<html>` for manual override
- localStorage persistence of user preference

#### Naming

- Use semantic class names
- Follow BEM methodology if complex
- Use consistent naming patterns
- Timeline classes: `.timeline-*` for all timeline components

### Git Standards

#### Commit Messages

```
feat: add new event type
fix: resolve database connection issue
docs: update API documentation
style: improve button styling
refactor: reorganize event handling code
test: add unit tests for BabyTracker class
```

#### Branch Naming

```
feature/add-sleep-tracking
fix/database-connection-leak
hotfix/critical-security-issue
```

---

## 8. 🔄 Development Workflow

### Feature Development

1. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and test locally**

3. **Commit changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

4. **Push to remote**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create pull request**

6. **Review and merge**

### Hotfix Process

1. **Create hotfix branch from main**
   ```bash
   git checkout -b hotfix/issue-description main
   ```

2. **Fix the issue and test**

3. **Commit and push**
   ```bash
   git add .
   git commit -m "fix: resolve specific issue"
   git push origin hotfix/issue-description
   ```

4. **Merge to main and deploy**

---

## 9. 📈 Performance Optimization

### Frontend Optimizations

- Minimize DOM manipulations
- Use event delegation where possible
- Optimize CSS selectors
- Compress images (if added)

### Backend Optimizations

- Use database connection pooling
- Implement query optimization
- Add appropriate indexes
- Use caching for frequently accessed data

### Database Optimizations

```sql
-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_baby_events_timestamp ON baby_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_baby_events_type ON baby_events(type);
CREATE INDEX IF NOT EXISTS idx_baby_events_date ON baby_events(DATE(timestamp));
```

---

## 10. 🔒 Security Considerations

### Input Validation

```javascript
// Always validate user input
const ALLOWED_EVENT_TYPES = ['milk', 'poo', 'bath'];

if (!ALLOWED_EVENT_TYPES.includes(type)) {
  return res.status(400).json({ error: 'Invalid event type' });
}
```

### XSS Prevention

```javascript
// Use textContent instead of innerHTML for user data
element.textContent = userData;

// If HTML is needed, sanitize or use safe patterns
const safeHTML = `<div>${escapeHtml(userData)}</div>`;
```

### SQL Injection Prevention

```javascript
// Always use parameterized queries
await pool.query(
  'INSERT INTO table (column) VALUES ($1)',
  [userInput]
);
```

---

## 🎉 Development Complete!

### Next Steps

1. **Test thoroughly** before deployment
2. **Update documentation** for new features
3. **Consider adding tests** for critical functionality
4. **Monitor performance** in production

### Resources

- [API Documentation](API.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Express.js Documentation](https://expressjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**Happy Coding!** 🚀