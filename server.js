const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, Event } = require('./database');

// Input validation constants
const ALLOWED_EVENT_TYPES = ['milk', 'poo', 'bath', 'sleep'];
const ALLOWED_USERS = ['Charie', 'Angie', 'Tim', 'Mengyu'];
const MAX_FILTER_LENGTH = 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway deployment (required for rate limiting)
app.set('trust proxy', 1);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : false)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  optionsSuccessStatus: 200
};

// Middleware
app.use(helmet()); // Security headers
app.use(cors(corsOptions)); // CORS with proper configuration
app.use(express.json({ limit: '10kb' })); // Body parser with size limit
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(limiter); // Rate limiting
app.use(express.static(PUBLIC_DIR));

async function getEventsHandler(req, res) {
  try {
    const { filter } = req.query;
    const rawType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const typeFilter = rawType && rawType !== 'all' ? rawType : '';

    if (typeFilter && !ALLOWED_EVENT_TYPES.includes(typeFilter)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    let events;

    if (filter) {
      if (typeof filter !== 'string') {
        return res.status(400).json({ error: 'Invalid filter format' });
      }

      if (filter.length > MAX_FILTER_LENGTH) {
        return res.status(400).json({ error: 'Filter parameter is too long' });
      }

      let filterData;
      try {
        filterData = JSON.parse(filter);
      } catch (parseError) {
        return res.status(400).json({ error: 'Invalid filter format' });
      }

      events = await Event.getFiltered(filterData);
    } else if (typeFilter) {
      events = await Event.getByType(typeFilter);
    } else {
      events = await Event.getAll();
    }

    if (typeFilter && filter) {
      events = events.filter(event => event.type === typeFilter);
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
}

// API Routes

// Get all events
app.get('/api/events', getEventsHandler);

// Create a new event
app.post('/api/events', async (req, res) => {
  try {
    console.log('Received event creation request:', req.body);
    const { type, amount, userName, sleepSubType, sleepStartTime, sleepEndTime } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    if (!ALLOWED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    if (!userName) {
      return res.status(400).json({ error: 'User name is required' });
    }

    if (!ALLOWED_USERS.includes(userName)) {
      return res.status(400).json({ error: 'Invalid user' });
    }

    if (type === 'milk' && (!amount || isNaN(amount) || amount <= 0)) {
      return res.status(400).json({ error: 'Milk amount is required and must be a positive number' });
    }

    // Handle sleep events with fall asleep/wake up tracking
    let calculatedAmount = null;
    let sleepStart = null;
    let sleepEnd = null;

    if (type === 'sleep') {
      if (sleepSubType === 'fall_asleep') {
        sleepStart = new Date().toISOString();
      } else if (sleepSubType === 'wake_up') {
        sleepEnd = new Date().toISOString();

        // Find the most recent fall asleep event for this user (optimized query)
        const lastFallAsleep = await Event.getLastIncompleteSleep(userName);

        if (lastFallAsleep) {
          sleepStart = lastFallAsleep.sleep_start_time;
          const duration = Math.round((new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)); // minutes
          calculatedAmount = duration > 0 ? duration : 1;

          // Update the fall asleep event with end time and duration
          await Event.update(lastFallAsleep.id, 'sleep', calculatedAmount, sleepStart, sleepEnd);
          return res.status(201).json({ ...lastFallAsleep, amount: calculatedAmount, sleep_end_time: sleepEnd });
        } else {
          return res.status(400).json({ error: 'No fall asleep event found to complete sleep session' });
        }
      } else {
        // Legacy sleep event with manual duration
        if (!amount || amount <= 0) {
          return res.status(400).json({ error: 'Sleep duration is required and must be positive' });
        }
        calculatedAmount = parseInt(amount);
      }
    } else {
      calculatedAmount = type === 'milk' ? parseInt(amount) : null;
      // Additional validation after parsing for milk events
      if (type === 'milk' && (isNaN(calculatedAmount) || calculatedAmount <= 0)) {
        return res.status(400).json({ error: 'Milk amount must be a valid positive number' });
      }

      // Check if there's an incomplete sleep event for this user
      // If so, automatically complete it with the current time as wake up time
      const incompleteSleep = await Event.getLastIncompleteSleep(userName);
      if (incompleteSleep) {
        const sleepEnd = new Date().toISOString();
        const sleepStart = incompleteSleep.sleep_start_time;
        const duration = Math.round((new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)); // minutes
        const sleepAmount = duration > 0 ? duration : 1;

        // Update the incomplete sleep event with end time and duration
        await Event.update(incompleteSleep.id, 'sleep', sleepAmount, sleepStart, sleepEnd);
        console.log(`Auto-completed sleep event ${incompleteSleep.id} with ${type} event`);
      }
    }

    console.log('Creating event with data:', { type, calculatedAmount, userName, sleepStart, sleepEnd });
    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd);
    console.log('Event created successfully:', event);
    res.status(201).json(event);
  } catch (error) {
    console.error('❌ Error creating event:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Environment info:', {
      DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
      NODE_ENV: process.env.NODE_ENV,
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT
    });
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get today's stats
app.get('/api/stats/today', async (req, res) => {
  try {
    const stats = await Event.getTodayStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Delete an event
app.delete('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Event.delete(parseInt(id));
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Update an event
async function updateEventHandler(req, res) {
  try {
    const { id } = req.params;
    const { type, amount } = req.body;

    const eventId = parseInt(id, 10);

    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    if (!type) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    if (!ALLOWED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    const existingEvent = await Event.getById(eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    let normalizedAmount = null;

    if (type === 'milk') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Milk amount is required and must be a valid positive number' });
      }
      normalizedAmount = parsedAmount;
    } else if (type === 'sleep') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Sleep duration is required and must be a valid positive number' });
      }
      normalizedAmount = parsedAmount;
    }

    const preserveSleepTimestamps = type === 'sleep';
    const existingSleepStart = existingEvent.sleep_start_time ?? existingEvent.sleepStartTime ?? null;
    const existingSleepEnd = existingEvent.sleep_end_time ?? existingEvent.sleepEndTime ?? null;

    const event = await Event.update(
      eventId,
      type,
      normalizedAmount,
      preserveSleepTimestamps ? existingSleepStart : null,
      preserveSleepTimestamps ? existingSleepEnd : null
    );
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    if (error.message === 'Event not found') {
      res.status(404).json({ error: 'Event not found' });
    } else {
      res.status(500).json({ error: 'Failed to update event' });
    }
  }
}

app.put('/api/events/:id', updateEventHandler);

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const { testConnection } = require('./database');
    const dbConnected = await testConnection();

    res.json({
      status: dbConnected ? 'OK' : 'ERROR',
      message: 'Baby Tracker API is running',
      database: dbConnected ? 'Connected' : 'Disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Health check failed',
      database: 'Error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Baby Tracker server running on port ${PORT}`);
      console.log(`📱 Open http://localhost:${PORT} to view the app`);
      console.log(`🗄️  Database connected successfully`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  getEventsHandler,
  updateEventHandler
};
