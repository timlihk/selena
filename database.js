const { Pool } = require('pg');
require('dotenv').config();

// Database connection configuration
let pool;

if (!process.env.DATABASE_URL) {
  // For environments without database URL, use in-memory storage
  console.log('⚠️  No DATABASE_URL found - using in-memory storage');
  pool = null;
} else {
  // For Railway and other cloud platforms, always use SSL
  const sslConfig = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT ? { rejectUnauthorized: false } : false;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig,
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
      console.log('✅ No DATABASE_URL - using in-memory storage');
      return true;
    }

    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as current_time');
      console.log('✅ Database connection successful:', result.rows[0].current_time);
      return true;
    } finally {
      client.release();
    }
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
      console.log('✅ No DATABASE_URL - in-memory storage ready');
      return;
    }

    const client = await pool.connect();
    try {
      // Create events table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS baby_events (
          id SERIAL PRIMARY KEY,
          type VARCHAR(20) NOT NULL,
          amount INTEGER,
          user_name VARCHAR(50) NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          sleep_start_time TIMESTAMP,
          sleep_end_time TIMESTAMP
        )
      `);

      // Check if user_name column exists, if not add it
      const columnCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'baby_events' AND column_name = 'user_name'
      `);

      if (columnCheck.rows.length === 0) {
        console.log('⚠️  Adding missing user_name column to baby_events table');
        await client.query(`
          ALTER TABLE baby_events
          ADD COLUMN user_name VARCHAR(50) NOT NULL DEFAULT 'Unknown'
        `);
      }

      // Check if sleep_start_time and sleep_end_time columns exist
      const sleepColumnsCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'baby_events'
        AND column_name IN ('sleep_start_time', 'sleep_end_time')
      `);

      const existingSleepColumns = sleepColumnsCheck.rows.map(row => row.column_name);

      if (!existingSleepColumns.includes('sleep_start_time')) {
        console.log('⚠️  Adding missing sleep_start_time column to baby_events table');
        await client.query(`
          ALTER TABLE baby_events
          ADD COLUMN sleep_start_time TIMESTAMP
        `);
      }

      if (!existingSleepColumns.includes('sleep_end_time')) {
        console.log('⚠️  Adding missing sleep_end_time column to baby_events table');
        await client.query(`
          ALTER TABLE baby_events
          ADD COLUMN sleep_end_time TIMESTAMP
        `);
      }

      console.log('✅ Database initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    throw error; // Re-throw to stop server startup
  }
}

// In-memory storage for development
let memoryEvents = [];
let nextId = 1;

function resetMemoryStore() {
  if (pool === null) {
    memoryEvents = [];
    nextId = 1;
  }
}

// Event operations
const Event = {
  // Get event by ID
  async getById(id) {
    try {
      if (pool === null) {
        return memoryEvents.find(event => event.id === parseInt(id));
      }

      const result = await pool.query(
        'SELECT * FROM baby_events WHERE id = $1 LIMIT 1',
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting event by id:', error);
      throw error;
    }
  },

  // Get events by type
  async getByType(type) {
    try {
      if (pool === null) {
        // In-memory mode
        return memoryEvents
          .filter(event => event.type === type)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      const result = await pool.query(
        'SELECT * FROM baby_events WHERE type = $1 ORDER BY timestamp DESC',
        [type]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting events by type:', error);
      throw error;
    }
  },

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
  async create(type, amount = null, userName = 'Unknown', sleepStartTime = null, sleepEndTime = null) {
    try {
      if (pool === null) {
        // In-memory mode
        const event = {
          id: nextId++,
          type,
          amount,
          user_name: userName,
          timestamp: new Date().toISOString(),
          sleep_start_time: sleepStartTime,
          sleep_end_time: sleepEndTime
        };
        memoryEvents.push(event);
        return event;
      }

      const result = await pool.query(
        'INSERT INTO baby_events (type, amount, user_name, sleep_start_time, sleep_end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [type, amount, userName, sleepStartTime, sleepEndTime]
      );
      return result.rows[0];
    } catch (error) {
      console.error('❌ Database error creating event:', error);
      console.error('❌ Database error details:', {
        type, amount, userName, sleepStartTime, sleepEndTime,
        poolExists: pool !== null,
        poolType: pool ? 'PostgreSQL' : 'In-memory',
        DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
        NODE_ENV: process.env.NODE_ENV,
        RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT
      });
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
          totalMilk: 0,
          totalSleepHours: 0
        };

        let totalSleepMinutes = 0;

        todayEvents.forEach(event => {
          stats[event.type] = (stats[event.type] || 0) + 1;
          if (event.type === 'milk' && event.amount) {
            stats.totalMilk += event.amount;
          }
          if (event.type === 'sleep' && event.amount) {
            totalSleepMinutes += event.amount;
          }
        });

        stats.totalSleepHours = Math.round((totalSleepMinutes / 60) * 10) / 10;

        return stats;
      }

      const result = await pool.query(`
        SELECT
          type,
          COUNT(*) as count,
          SUM(CASE WHEN type = 'milk' THEN amount ELSE 0 END) as total_milk,
          SUM(CASE WHEN type = 'sleep' THEN amount ELSE 0 END) as total_sleep_minutes
        FROM baby_events
        WHERE DATE(timestamp) = CURRENT_DATE
        GROUP BY type
      `);

      // Format the stats
      const stats = {
        milk: 0,
        poo: 0,
        bath: 0,
        totalMilk: 0,
        totalSleepHours: 0
      };

      result.rows.forEach(row => {
        stats[row.type] = parseInt(row.count);
        if (row.type === 'milk') {
          stats.totalMilk = parseInt(row.total_milk) || 0;
        }
      });

      // Calculate total sleep hours from minutes
      const totalSleepMinutes = result.rows.find(row => row.type === 'sleep')?.total_sleep_minutes || 0;
      stats.totalSleepHours = Math.round((totalSleepMinutes / 60) * 10) / 10; // Round to 1 decimal place

      return stats;
    } catch (error) {
      console.error('Error getting today stats:', error);
      throw error;
    }
  },

  // Get the last incomplete sleep event for a user (N+1 query fix)
  async getLastIncompleteSleep(userName) {
    try {
      if (pool === null) {
        // In-memory mode
        return memoryEvents
          .filter(event =>
            event.type === 'sleep' &&
            event.user_name === userName &&
            event.sleep_start_time &&
            !event.sleep_end_time
          )
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      }

      const result = await pool.query(
        `SELECT * FROM baby_events
         WHERE type = 'sleep'
           AND user_name = $1
           AND sleep_start_time IS NOT NULL
           AND sleep_end_time IS NULL
         ORDER BY timestamp DESC
         LIMIT 1`,
        [userName]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting last incomplete sleep event:', error);
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
  async update(id, type, amount = null, sleepStartTime = null, sleepEndTime = null) {
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
        if (sleepStartTime !== undefined) event.sleep_start_time = sleepStartTime;
        if (sleepEndTime !== undefined) event.sleep_end_time = sleepEndTime;
        return event;
      }

      const result = await pool.query(
        'UPDATE baby_events SET type = $1, amount = $2, sleep_start_time = $3, sleep_end_time = $4 WHERE id = $5 RETURNING *',
        [type, amount, sleepStartTime, sleepEndTime, id]
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
  testConnection,
  resetMemoryStore
};
