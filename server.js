const express = require('express');
const path = require('path');
const cors = require('cors');
const { initializeDatabase, Event } = require('./database');

// Input validation constants
const ALLOWED_EVENT_TYPES = ['milk', 'poo', 'bath', 'sleep'];
const ALLOWED_USERS = ['Charie', 'Angie', 'Tim', 'Mengyu'];

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// API Routes

// Get all events
app.get('/api/events', async (req, res) => {
  try {
    const { filter } = req.query;
    let events;

    if (filter) {
      const filterData = JSON.parse(filter);
      events = await Event.getFiltered(filterData);
    } else {
      events = await Event.getAll();
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

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

    if (type === 'milk' && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Milk amount is required and must be positive' });
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

        // Find the most recent fall asleep event for this user
        const events = await Event.getAll();
        const lastFallAsleep = events.find(event =>
          event.type === 'sleep' &&
          event.user_name === userName &&
          event.sleep_start_time &&
          !event.sleep_end_time
        );

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
    }

    console.log('Creating event with data:', { type, calculatedAmount, userName, sleepStart, sleepEnd });
    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd);
    console.log('Event created successfully:', event);
    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
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
app.put('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    if (!ALLOWED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    if (type === 'milk' && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Milk amount is required and must be positive' });
    }

    if (type === 'sleep' && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Sleep duration is required and must be positive' });
    }

    const event = await Event.update(parseInt(id), type, (type === 'milk' || type === 'sleep') ? parseInt(amount) : null);
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    if (error.message === 'Event not found') {
      res.status(404).json({ error: 'Event not found' });
    } else {
      res.status(500).json({ error: 'Failed to update event' });
    }
  }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

startServer();