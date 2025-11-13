const { Pool } = require('pg');
require('dotenv').config();

// Database connection configuration
let pool;

if (process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL) {
  // For development without database, use in-memory storage
  console.log('⚠️  Running in development mode without database - using in-memory storage');
  pool = null;
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // Add connection timeout and retry settings
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
  });
}

// Test database connection
async function testConnection() {
  try {
    console.log('🔌 Testing database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

    if (pool === null) {
      console.log('✅ Development mode - using in-memory storage');
      return true;
    }

    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful:', result.rows[0].current_time);
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Full error:', error);
    return false;
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Cannot initialize database - connection failed');
    }

    if (pool === null) {
      console.log('✅ Development mode - in-memory storage ready');
      return;
    }

    const client = await pool.connect();

    // Create events table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS baby_events (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL,
        amount INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database initialized successfully');
    client.release();
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    throw error; // Re-throw to stop server startup
  }
}

// In-memory storage for development
let memoryEvents = [];
let nextId = 1;

// Event operations
const Event = {
  // Get all events
  async getAll() {
    try {
      if (pool === null) {
        // In-memory mode
        return memoryEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      const result = await pool.query(
        'SELECT * FROM baby_events ORDER BY timestamp DESC'
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting events:', error);
      throw error;
    }
  },

  // Get filtered events
  async getFiltered(filter) {
    try {
      if (pool === null) {
        // In-memory mode
        let filteredEvents = [...memoryEvents];

        if (filter.startDate) {
          const start = new Date(filter.startDate);
          filteredEvents = filteredEvents.filter(event => new Date(event.timestamp) >= start);
        }

        if (filter.endDate) {
          const end = new Date(filter.endDate);
          filteredEvents = filteredEvents.filter(event => new Date(event.timestamp) <= end);
        }

        return filteredEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      let query = 'SELECT * FROM baby_events';
      let params = [];
      let conditions = [];

      if (filter.startDate) {
        conditions.push('timestamp >= $' + (params.length + 1));
        params.push(filter.startDate);
      }

      if (filter.endDate) {
        conditions.push('timestamp <= $' + (params.length + 1));
        params.push(filter.endDate + ' 23:59:59'); // Include entire end date
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY timestamp DESC';

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting filtered events:', error);
      throw error;
    }
  },

  // Create a new event
  async create(type, amount = null) {
    try {
      if (pool === null) {
        // In-memory mode
        const event = {
          id: nextId++,
          type,
          amount,
          timestamp: new Date().toISOString()
        };
        memoryEvents.push(event);
        return event;
      }

      const result = await pool.query(
        'INSERT INTO baby_events (type, amount) VALUES ($1, $2) RETURNING *',
        [type, amount]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating event:', error);
      throw error;
    }
  },

  // Get today's events
  async getTodayStats() {
    try {
      if (pool === null) {
        // In-memory mode
        const today = new Date().toISOString().split('T')[0];
        const todayEvents = memoryEvents.filter(event =>
          event.timestamp.split('T')[0] === today
        );

        const stats = {
          milk: 0,
          poo: 0,
          bath: 0,
          totalMilk: 0
        };

        todayEvents.forEach(event => {
          stats[event.type] = (stats[event.type] || 0) + 1;
          if (event.type === 'milk' && event.amount) {
            stats.totalMilk += event.amount;
          }
        });

        return stats;
      }

      const result = await pool.query(`
        SELECT
          type,
          COUNT(*) as count,
          SUM(CASE WHEN type = 'milk' THEN amount ELSE 0 END) as total_milk
        FROM baby_events
        WHERE DATE(timestamp) = CURRENT_DATE
        GROUP BY type
      `);

      // Format the stats
      const stats = {
        milk: 0,
        poo: 0,
        bath: 0,
        totalMilk: 0
      };

      result.rows.forEach(row => {
        stats[row.type] = parseInt(row.count);
        if (row.type === 'milk') {
          stats.totalMilk = parseInt(row.total_milk) || 0;
        }
      });

      return stats;
    } catch (error) {
      console.error('Error getting today stats:', error);
      throw error;
    }
  },

  // Delete an event
  async delete(id) {
    try {
      if (pool === null) {
        // In-memory mode
        const index = memoryEvents.findIndex(event => event.id === parseInt(id));
        if (index === -1) {
          throw new Error('Event not found');
        }
        memoryEvents.splice(index, 1);
        return true;
      }

      await pool.query('DELETE FROM baby_events WHERE id = $1', [id]);
      return true;
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  },

  // Update an event
  async update(id, type, amount = null) {
    try {
      if (pool === null) {
        // In-memory mode
        const event = memoryEvents.find(event => event.id === parseInt(id));
        if (!event) {
          throw new Error('Event not found');
        }
        event.type = type;
        event.amount = amount;
        event.timestamp = new Date().toISOString();
        return event;
      }

      const result = await pool.query(
        'UPDATE baby_events SET type = $1, amount = $2 WHERE id = $3 RETURNING *',
        [type, amount, id]
      );

      if (result.rows.length === 0) {
        throw new Error('Event not found');
      }

      return result.rows[0];
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  }
};

module.exports = {
  pool,
  initializeDatabase,
  Event,
  testConnection
};