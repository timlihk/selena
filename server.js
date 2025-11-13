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
    const { type, amount, userName } = req.body;

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

    if (type === 'sleep' && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Sleep duration is required and must be positive' });
    }

    const event = await Event.create(type, (type === 'milk' || type === 'sleep') ? parseInt(amount) : null, userName);
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