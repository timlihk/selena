# 👶 Baby Event Tracker

A full-stack web application for tracking newborn baby activities including milk feeds, diaper changes, and bath times. Built with Node.js, Express, PostgreSQL, and vanilla JavaScript.

**Live Demo**: [https://selena.mangrove-hk.org/](https://selena.mangrove-hk.org/)

## ✨ Features

- **📊 Event Tracking**: Record milk feeds (with ml amount), diaper changes (pee/poo/both), bath times, and guided sleep sessions
- **📈 Real-time Statistics**: View today's summary with event counts and total milk consumption
- **😴 Smart Sleep Tracking**: Fall-asleep/wake-up buttons automatically calculate sleep duration and close open sessions
- **📱 Responsive Design**: Mobile-first design that works on all devices
- **💾 Data Persistence**: PostgreSQL database for reliable data storage
- **🎨 Beautiful UI**: Clean, modern interface with smooth animations
- **🔒 Security**: HTTPS, input validation, and secure database connections
- **⚡ Performance**: Optimized database queries and efficient rendering

## 🚀 Quick Start

### Prerequisites
- Node.js 14+
- PostgreSQL database
- Git

### Local Development

1. **Clone and install dependencies**:
   ```bash
   git clone <repository-url>
   cd selena
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open http://localhost:3000** in your browser

> **Note:** When `DATABASE_URL` is not configured the app automatically falls back to an in-memory datastore. This mode is perfect for local development and automated tests but should never be used for production deployments because data will be lost on restart.

## 🏗️ Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | User interface and interactions |
| **Backend** | Node.js, Express.js | API server and routing |
| **Database** | PostgreSQL | Data persistence |
| **Deployment** | Railway.app | Cloud hosting platform |
| **DNS/CDN** | Cloudflare | Domain management and security |

### Project Structure

```
selena/
├── 📄 index.html          # Main HTML entry point
├── 🎨 styles.css          # Complete CSS styling
├── ⚡ script.js           # Frontend JavaScript logic
├── 🖥️ server.js           # Express.js server
├── 🗄️ database.js         # Database configuration and models
├── 📦 package.json        # Dependencies and scripts
├── 🚄 railway.json        # Railway deployment configuration
├── 🔧 .env.example        # Environment variables template
├── 📚 README.md           # This documentation
└── 📋 API.md              # API documentation
```

## 📊 Database Schema

```sql
CREATE TABLE baby_events (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  amount INTEGER,
  user_name VARCHAR(50) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  sleep_start_time TIMESTAMPTZ,
  sleep_end_time TIMESTAMPTZ
);
```

**Indexes**:
- `timestamp` (for sorting and filtering)
- `type` (for statistics queries)
- `date(timestamp)` (for daily statistics)

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ | - |
| `NODE_ENV` | Environment (development/production) | ❌ | development |
| `PORT` | Server port | ❌ | 3000 |
| `BABY_HOME_TIMEZONE` | Olson timezone used for "today" calculations | ❌ | Asia/Hong_Kong |
| `DB_STORAGE_TIMEZONE` | Timezone legacy timestamps were recorded in (used only during automatic migrations) | ❌ | UTC |

### Example `.env` file:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/baby_tracker
NODE_ENV=development
PORT=3000
BABY_HOME_TIMEZONE=Asia/Hong_Kong
DB_STORAGE_TIMEZONE=UTC
```

## 🎯 Usage Guide

### Adding Events

1. **Select Event Type**: Choose from Milk, Diaper Change, Bath, or Sleep
2. **Set Details**:
   - Milk: enter the amount in ml
   - Diaper: choose pee/poo/both using the buttons
   - Sleep: use the dedicated Fall Asleep / Wake Up buttons instead of the main form
3. **Identify the Recorder**: Pick the caregiver under "Who is recording"
4. **Add Event**: Click "Add Event" (or the sleep buttons) to record the activity

### Viewing Data

- **Recent Events**: See all recorded events in reverse chronological order
- **Today's Summary**: View counts for each event type and total milk consumed
- **Event Details**: Each event shows timestamp and amount (for milk feeds)

### Event Types

| Type | Icon | Description | Data Collected |
|------|------|-------------|----------------|
| 🍼 Milk | 🍼 | Milk feeding session | Amount in ml |
| 💩 Diaper | 💧 / 💩 | Diaper change with pee/poo/both subtype | Subtype only |
| 😴 Sleep | 😴 | Sleep session using fall-asleep/wake-up buttons | Duration in minutes |
| 🛁 Bath | 🛁 | Bath time | - |

## 🚀 Deployment

### Railway.app Deployment

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and deploy**:
   ```bash
   railway login
   railway add postgresql
   railway up
   ```

3. **Configure custom domain** (optional):
   - Add domain in Railway dashboard
   - Configure CNAME in Cloudflare
   - Add verification TXT records

### Manual Deployment

1. **Set up production environment variables**
2. **Build and start the application**:
   ```bash
   npm start
   ```

## 🔌 API Reference

See [API.md](API.md) for complete API documentation.

### Key Endpoints

- `GET /api/events` - Get all events
- `POST /api/events` - Create new event
- `GET /api/stats/today` - Get today's statistics
- `DELETE /api/events/:id` - Delete specific event
- `GET /health` - Health check

## 🛠️ Development

### Code Structure

#### Frontend (`script.js`)
- `BabyTracker` class manages application state
- Event listeners for user interactions
- API communication via Fetch API
- Dynamic UI updates

#### Backend (`server.js`)
- Express.js server with middleware
- RESTful API endpoints
- Error handling and validation
- Static file serving

#### Database (`database.js`)
- PostgreSQL connection pool
- Event CRUD operations
- Statistics aggregation
- Database initialization

### Adding New Features

1. **Database**: Update schema in `database.js`
2. **API**: Add endpoints in `server.js`
3. **Frontend**: Update `script.js` and `index.html`
4. **Styling**: Update `styles.css`

## 🧪 Testing

### Manual Testing Checklist

- [ ] Add events of all types
- [ ] Verify statistics update correctly
- [ ] Test on mobile devices
- [ ] Check error handling
- [ ] Verify data persistence

### API Testing

```bash
# Test health endpoint
curl https://selena.mangrove-hk.org/health

# Test events endpoint
curl https://selena.mangrove-hk.org/api/events
```

## 🔒 Security Features

- **Input Validation**: Server-side validation for all inputs
- **XSS Protection**: Safe DOM manipulation
- **SQL Injection Prevention**: Parameterized queries
- **HTTPS Enforcement**: SSL/TLS encryption
- **CORS Configuration**: Controlled cross-origin requests
- **Rate Limiting**: API abuse protection

## 📈 Performance

### Optimizations
- Database connection pooling
- Efficient SQL queries with indexes
- Client-side caching where appropriate
- Optimized static file serving
- CDN caching via Cloudflare

### Monitoring
- Railway app logs and metrics
- Cloudflare analytics
- Database query performance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Standards
- Use consistent naming conventions
- Add comments for complex logic
- Follow existing code style
- Test all changes

## 🐛 Troubleshooting

### Common Issues

**Database Connection Issues**
- Check `DATABASE_URL` environment variable
- Verify PostgreSQL is running
- Check network connectivity

**404 Errors**
- Verify route configurations
- Check static file paths
- Ensure all files are deployed

**Performance Issues**
- Check database indexes
- Monitor query performance
- Review client-side rendering

### Getting Help

- Check Railway logs for errors
- Review Cloudflare analytics
- Test API endpoints directly
- Verify environment variables

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with ❤️ for new parents
- Deployed on [Railway.app](https://railway.app)
- Secured with [Cloudflare](https://cloudflare.com)
- Powered by [PostgreSQL](https://postgresql.org)

---

**Need help?** Check the [API documentation](API.md) or create an issue in the repository.
