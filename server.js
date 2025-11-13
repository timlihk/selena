const express = require('express');
const path = require('path');
const cors = require('cors');
const { initializeDatabase, Event } = require('./database');

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
    const events = await Event.getAll();
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create a new event
app.post('/api/events', async (req, res) => {
  try {
    const { type, amount } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    if (type === 'milk' && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Milk amount is required and must be positive' });
    }

    const event = await Event.create(type, type === 'milk' ? parseInt(amount) : null);
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

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Baby Tracker API is running' });
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