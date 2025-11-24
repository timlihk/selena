const { Pool } = require('pg');
require('dotenv').config();

// Custom error classes
class DatabaseError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

class TransactionError extends DatabaseError {
  constructor(message, originalError = null) {
    super(message, originalError);
    this.name = 'TransactionError';
  }
}

class ConcurrentUpdateError extends DatabaseError {
  constructor(message = 'Concurrent update detected') {
    super(message);
    this.name = 'ConcurrentUpdateError';
  }
}

// Timezone configuration
const HOME_TIMEZONE = process.env.BABY_HOME_TIMEZONE || 'Asia/Hong_Kong';
const HISTORICAL_DATA_TIMEZONE = process.env.DB_STORAGE_TIMEZONE || 'UTC';

const useMemoryStore = !process.env.DATABASE_URL;

// Database connection configuration
let pool = null;

// In-memory fallback for local development/tests when DATABASE_URL is missing
let memoryStore = [];
let memoryIdCounter = 1;

function cloneEvent(event) {
  return event ? { ...event } : null;
}

function ensureMemoryTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resetMemoryStore() {
  memoryStore = [];
  memoryIdCounter = 1;
}

function sortEventsDescending(events) {
  return [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function formatDateInTimezone(date, timeZone) {
  return date.toLocaleDateString('en-US', { timeZone });
}

function formatISODateInTimezone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function createMemoryEvent(
  type,
  amount = null,
  userName = 'Unknown',
  sleepStartTime = null,
  sleepEndTime = null,
  subtype = null,
  timestampOverride = null
) {
  const event = {
    id: memoryIdCounter++,
    type,
    amount,
    user_name: userName,
    timestamp: ensureMemoryTimestamp(timestampOverride) || new Date().toISOString(),
    sleep_start_time: ensureMemoryTimestamp(sleepStartTime),
    sleep_end_time: ensureMemoryTimestamp(sleepEndTime),
    subtype
  };
  memoryStore.push(event);
  return cloneEvent(event);
}

function updateMemoryEvent(index, updates) {
  if (index < 0 || index >= memoryStore.length) {
    throw new Error('Event not found');
  }
  const existing = memoryStore[index];
  const updated = {
    ...existing,
    ...updates
  };
  memoryStore[index] = updated;
  return cloneEvent(updated);
}

function findMemoryEventIndexById(id) {
  return memoryStore.findIndex(event => event.id === id);
}

// For Railway and other cloud platforms, always use SSL
const sslConfig = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT ? { rejectUnauthorized: false } : false;

// Initialize pool only when DATABASE_URL is available
try {
  if (!useMemoryStore) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      // Add connection timeout and retry settings
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 20
    });
    console.log('Database pool initialized successfully');
  } else {
    console.warn('⚠️  DATABASE_URL is not set. Falling back to in-memory data store (not for production use).');
  }
} catch (error) {
  console.error('Database pool initialization failed:', error.message);
  // Don't throw - allow server to start
}

// Helper function to check if database is connected
function ensureDatabaseConnected() {
  if (useMemoryStore) {
    return;
  }
  if (!pool) {
    throw new Error('Database not connected. DATABASE_URL environment variable is required');
  }
}

// Test database connection
async function testConnection() {
  try {
    if (useMemoryStore) {
      console.log('🔌 DATABASE_URL not set - running with in-memory data store');
      return false;
    }

    console.log('🔌 Testing database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

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

// Execute callback within a database transaction
async function withTransaction(callback) {
  if (useMemoryStore) {
    // Enhanced memory store transaction simulation
    let transactionState = 'active';
    const transactionClient = {
      query: async (text, params = []) => {
        const normalizedText = text.trim().toUpperCase();

        // Handle transaction control statements
        if (normalizedText === 'BEGIN') {
          transactionState = 'active';
          return { rows: [] };
        } else if (normalizedText === 'COMMIT') {
          transactionState = 'committed';
          return { rows: [] };
        } else if (normalizedText === 'ROLLBACK') {
          transactionState = 'rolled_back';
          return { rows: [] };
        }

        // Only allow queries when transaction is active
        if (transactionState !== 'active') {
          throw new Error(`Transaction is ${transactionState}, cannot execute query`);
        }

        // Execute the actual query using the regular pool or memory store
        if (pool) {
          return pool.query(text, params);
        } else {
          // For memory store without pool, simulate query execution
          if (text.trim().toUpperCase().startsWith('SELECT')) {
            return { rows: [{ test: 1 }] };
          }
          return { rows: [] };
        }
      }
    };

    try {
      await transactionClient.query('BEGIN');
      const result = await callback(transactionClient);
      await transactionClient.query('COMMIT');
      return result;
    } catch (error) {
      if (transactionState === 'active') {
        await transactionClient.query('ROLLBACK');
      }
      throw error;
    }
  }

  ensureDatabaseConnected();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }

    // Wrap database errors with custom error types
    if (error.code === '23505') { // unique_violation
      throw new ConcurrentUpdateError('Concurrent update conflict detected', error);
    } else if (error.code && error.code.startsWith('23')) { // constraint violation
      throw new DatabaseError('Database constraint violation', error);
    } else if (error.code && error.code.startsWith('40')) { // transaction errors
      throw new TransactionError('Transaction failed', error);
    }

    throw new DatabaseError('Database operation failed', error);
  } finally {
    client.release();
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    if (useMemoryStore) {
      console.log('✅ In-memory data store ready (DATABASE_URL not configured)');
      return;
    }

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Cannot initialize database - connection failed');
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
          timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          sleep_start_time TIMESTAMPTZ,
          sleep_end_time TIMESTAMPTZ,
          subtype VARCHAR(20)
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
          ADD COLUMN sleep_start_time TIMESTAMPTZ
        `);
      }

      if (!existingSleepColumns.includes('sleep_end_time')) {
        console.log('⚠️  Adding missing sleep_end_time column to baby_events table');
        await client.query(`
          ALTER TABLE baby_events
          ADD COLUMN sleep_end_time TIMESTAMPTZ
        `);
      }

      // Check if subtype column exists, if not add it
      const subtypeColumnCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'baby_events' AND column_name = 'subtype'
      `);

      if (subtypeColumnCheck.rows.length === 0) {
        console.log('⚠️  Adding missing subtype column to baby_events table');
        await client.query(`
          ALTER TABLE baby_events
          ADD COLUMN subtype VARCHAR(20)
        `);
      }

      await normalizeTimestampColumns(client);

      // Ensure timestamp column keeps an explicit default even after type conversions
      await client.query(`
        ALTER TABLE baby_events
        ALTER COLUMN timestamp SET DEFAULT CURRENT_TIMESTAMP
      `);

      // Add helpful indexes for filtering and stats queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_baby_events_timestamp
        ON baby_events (timestamp DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_baby_events_type
        ON baby_events (type, timestamp DESC)
      `);

      // Add indexes for sleep concurrency queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_baby_events_sleep_incomplete
        ON baby_events (user_name, type, sleep_start_time, sleep_end_time)
        WHERE type = 'sleep' AND sleep_start_time IS NOT NULL AND sleep_end_time IS NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_baby_events_user_type
        ON baby_events (user_name, type, timestamp DESC)
      `);

      console.log('✅ Database initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    throw error; // Re-throw to stop server startup
  }
}


async function normalizeTimestampColumns(client) {
  const TIMESTAMP_COLUMNS = ['timestamp', 'sleep_start_time', 'sleep_end_time'];

  for (const column of TIMESTAMP_COLUMNS) {
    const { rows } = await client.query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_name = 'baby_events'
         AND column_name = $1
       LIMIT 1`,
      [column]
    );

    const dataType = rows[0]?.data_type;
    if (dataType === 'timestamp without time zone') {
      console.log(`⚠️  Converting ${column} to TIMESTAMPTZ using ${HISTORICAL_DATA_TIMEZONE} baseline`);
      // Use string interpolation for both column and timezone since they're from controlled sources
      await client.query(
        `ALTER TABLE baby_events
         ALTER COLUMN ${column}
         TYPE TIMESTAMPTZ
         USING ${column} AT TIME ZONE '${HISTORICAL_DATA_TIMEZONE}'`
      );
    }
  }
}

// Event operations
const Event = {
  // Get event by ID
  async getById(id) {
    try {
      if (useMemoryStore) {
        const event = memoryStore.find(item => item.id === id);
        return cloneEvent(event || null);
      }

      ensureDatabaseConnected();
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
      if (useMemoryStore) {
        return sortEventsDescending(memoryStore.filter(event => event.type === type)).map(cloneEvent);
      }

      ensureDatabaseConnected();
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
      if (useMemoryStore) {
        return sortEventsDescending(memoryStore).map(cloneEvent);
      }

      ensureDatabaseConnected();
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
      if (useMemoryStore) {
        const startDateString = filter.startDate;
        const endDateString = filter.endDate;

        const filtered = memoryStore.filter(event => {
          const eventDateIso = formatISODateInTimezone(new Date(event.timestamp), HOME_TIMEZONE);
          if (startDateString && eventDateIso < startDateString) {
            return false;
          }
          if (endDateString && eventDateIso > endDateString) {
            return false;
          }
          return true;
        });
        return sortEventsDescending(filtered).map(cloneEvent);
      }

      ensureDatabaseConnected();
      let query = 'SELECT * FROM baby_events';
      const params = [];
      const conditions = [];
      let timezoneParamIndex = null;

      const ensureTimezoneParam = () => {
        if (timezoneParamIndex === null) {
          params.push(HOME_TIMEZONE);
          timezoneParamIndex = params.length;
        }
        return timezoneParamIndex;
      };

      if (filter.startDate) {
        const tzIndex = ensureTimezoneParam();
        params.push(filter.startDate);
        const startParamIndex = params.length;
        conditions.push(`DATE(timestamp AT TIME ZONE $${tzIndex}) >= $${startParamIndex}::date`);
      }

      if (filter.endDate) {
        const tzIndex = ensureTimezoneParam();
        params.push(filter.endDate);
        const endParamIndex = params.length;
        conditions.push(`DATE(timestamp AT TIME ZONE $${tzIndex}) <= $${endParamIndex}::date`);
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
  async create(type, amount = null, userName = 'Unknown', sleepStartTime = null, sleepEndTime = null, subtype = null, timestamp = null) {
    try {
      if (useMemoryStore) {
        return createMemoryEvent(type, amount, userName, sleepStartTime, sleepEndTime, subtype, timestamp);
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'INSERT INTO baby_events (type, amount, user_name, sleep_start_time, sleep_end_time, subtype, timestamp) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP)) RETURNING *',
        [type, amount, userName, sleepStartTime, sleepEndTime, subtype, timestamp]
      );
      return result.rows[0];
    } catch (error) {
      console.error('❌ Database error creating event:', error);
      console.error('❌ Database error details:', {
        type, amount, userName, sleepStartTime, sleepEndTime, subtype, timestamp,
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
      if (useMemoryStore) {
        const todayString = formatDateInTimezone(new Date(), HOME_TIMEZONE);
        const statsAccumulator = memoryStore.reduce((acc, event) => {
          const eventDateString = formatDateInTimezone(new Date(event.timestamp), HOME_TIMEZONE);
          if (eventDateString !== todayString) {
            return acc;
          }

          if (event.type === 'milk') {
            acc.milk += 1;
            acc.totalMilk += event.amount || 0;
          } else if (event.type === 'sleep') {
            acc.sleep += 1;
            acc.totalSleepMinutes += event.amount || 0;
          } else if (event.type === 'bath') {
            acc.bath += 1;
          }

          if (event.type === 'diaper' || event.type === 'poo') {
            acc.diaper += 1;
          }

          return acc;
        }, {
          milk: 0,
          diaper: 0,
          bath: 0,
          sleep: 0,
          totalMilk: 0,
          totalSleepMinutes: 0
        });

        return {
          milk: statsAccumulator.milk,
          poo: statsAccumulator.diaper,
          bath: statsAccumulator.bath,
          sleep: statsAccumulator.sleep,
          totalMilk: statsAccumulator.totalMilk,
          totalSleepHours: Math.round((statsAccumulator.totalSleepMinutes / 60) * 10) / 10
        };
      }

      ensureDatabaseConnected();
      // Simplified query: Get all events where the date (in home timezone) matches today
      const result = await pool.query(`
        SELECT
          COUNT(CASE WHEN type = 'milk' THEN 1 END) as milk_count,
          COUNT(CASE WHEN type IN ('poo', 'diaper') THEN 1 END) as diaper_count,
          COUNT(CASE WHEN type = 'bath' THEN 1 END) as bath_count,
          COUNT(CASE WHEN type = 'sleep' THEN 1 END) as sleep_count,
          COALESCE(SUM(CASE WHEN type = 'milk' THEN amount ELSE 0 END), 0) as total_milk,
          COALESCE(SUM(CASE WHEN type = 'sleep' THEN amount ELSE 0 END), 0) as total_sleep_minutes
        FROM baby_events
        WHERE DATE(timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
      `, [HOME_TIMEZONE]);

      const row = result.rows[0] || {};

      // Format the stats
      const stats = {
        milk: parseInt(row.milk_count, 10) || 0,
        poo: parseInt(row.diaper_count, 10) || 0,
        bath: parseInt(row.bath_count, 10) || 0,
        sleep: parseInt(row.sleep_count, 10) || 0,
        totalMilk: parseInt(row.total_milk, 10) || 0,
        totalSleepHours: Math.round(((parseInt(row.total_sleep_minutes, 10) || 0) / 60) * 10) / 10
      };

      return stats;
    } catch (error) {
      console.error('Error getting today stats:', error);
      throw error;
    }
  },

  // Get weekly stats
  async getWeeklyStats() {
    try {
      if (useMemoryStore) {
        // This is a simplified in-memory version for testing
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentEvents = memoryStore.filter(e => new Date(e.timestamp) > sevenDaysAgo);
        return recentEvents;
      }

      ensureDatabaseConnected();
      const result = await pool.query(`
        WITH date_series AS (
          SELECT generate_series(
            (NOW() - interval '6 days')::date,
            NOW()::date,
            '1 day'::interval
          )::date AS day
        )
        SELECT
          d.day,
          COALESCE(SUM(CASE WHEN e.type = 'milk' THEN e.amount ELSE 0 END), 0) as total_milk,
          COALESCE(SUM(CASE WHEN e.type = 'sleep' THEN e.amount ELSE 0 END), 0) as total_sleep_minutes,
          COUNT(CASE WHEN e.type = 'diaper' OR e.type = 'poo' THEN 1 END) as diaper_count
        FROM date_series d
        LEFT JOIN baby_events e ON DATE(e.timestamp AT TIME ZONE $1) = d.day
        GROUP BY d.day
        ORDER BY d.day ASC
      `, [HOME_TIMEZONE]);

      return result.rows;
    } catch (error) {
      console.error('Error getting weekly stats:', error);
      throw error;
    }
  },

  // Get monthly stats
  async getMonthlyStats() {
    try {
      if (useMemoryStore) {
        // This is a simplified in-memory version for testing
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentEvents = memoryStore.filter(e => new Date(e.timestamp) > thirtyDaysAgo);
        return recentEvents;
      }

      ensureDatabaseConnected();
      const result = await pool.query(`
        WITH date_series AS (
          SELECT generate_series(
            (NOW() - interval '29 days')::date,
            NOW()::date,
            '1 day'::interval
          )::date AS day
        )
        SELECT
          d.day,
          COALESCE(SUM(CASE WHEN e.type = 'milk' THEN e.amount ELSE 0 END), 0) as total_milk,
          COALESCE(SUM(CASE WHEN e.type = 'sleep' THEN e.amount ELSE 0 END), 0) as total_sleep_minutes,
          COUNT(CASE WHEN e.type = 'diaper' OR e.type = 'poo' THEN 1 END) as diaper_count
        FROM date_series d
        LEFT JOIN baby_events e ON DATE(e.timestamp AT TIME ZONE $1) = d.day
        GROUP BY d.day
        ORDER BY d.day ASC
      `, [HOME_TIMEZONE]);

      return result.rows;
    } catch (error) {
      console.error('Error getting monthly stats:', error);
      throw error;
    }
  },

  // Get the last incomplete sleep event for a user (N+1 query fix)
  async getLastIncompleteSleep(userName) {
    try {
      if (useMemoryStore) {
        const event = sortEventsDescending(
          memoryStore.filter(item =>
            item.type === 'sleep' &&
            item.user_name === userName &&
            item.sleep_start_time &&
            !item.sleep_end_time
          )
        )[0];
        return cloneEvent(event || null);
      }

      ensureDatabaseConnected();
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

  // Get the last incomplete sleep WITH ROW LOCKING for transaction safety
  async getLastIncompleteSleepForUpdate(userName, client = null) {
    try {
      if (useMemoryStore) {
        // Memory store doesn't support locking
        return this.getLastIncompleteSleep(userName);
      }

      ensureDatabaseConnected();
      const queryClient = client || pool;

      const result = await queryClient.query(
        `SELECT * FROM baby_events
         WHERE type = 'sleep'
           AND user_name = $1
           AND sleep_start_time IS NOT NULL
           AND sleep_end_time IS NULL
         ORDER BY timestamp DESC
         LIMIT 1
         FOR UPDATE`, // <-- Locks this row exclusively
        [userName]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting locked incomplete sleep event:', error);
      throw error;
    }
  },

  // Find sleep events that overlap with a given time range
  async findOverlappingSleep(startTime, endTime, eventIdToExclude = null) {
    try {
      if (useMemoryStore) {
        // In-memory implementation for testing
        return memoryStore.filter(event => {
          if (event.type !== 'sleep' || !event.sleep_start_time || !event.sleep_end_time) {
            return false;
          }
          if (eventIdToExclude && event.id === eventIdToExclude) {
            return false;
          }
          const existingStart = new Date(event.sleep_start_time);
          const existingEnd = new Date(event.sleep_end_time);
          const newStart = new Date(startTime);
          const newEnd = new Date(endTime);
          // Overlap condition: (StartA < EndB) and (EndA > StartB)
          return newStart < existingEnd && newEnd > existingStart;
        }).map(cloneEvent);
      }

      ensureDatabaseConnected();
      const query = `
        SELECT id, sleep_start_time, sleep_end_time, amount, user_name
        FROM baby_events
        WHERE type = 'sleep'
          AND sleep_start_time IS NOT NULL
          AND sleep_end_time IS NOT NULL
          AND ($1, $2) OVERLAPS (sleep_start_time, sleep_end_time)
          AND ($3::int IS NULL OR id != $3::int)
      `;
      const params = [startTime, endTime, eventIdToExclude];
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error finding overlapping sleep events:', error);
      throw error;
    }
  },

  // Delete an event
  async delete(id) {
    try {
      if (useMemoryStore) {
        const index = findMemoryEventIndexById(id);
        if (index === -1) {
          throw new Error('Event not found');
        }
        memoryStore.splice(index, 1);
        return true;
      }

      ensureDatabaseConnected();
      const result = await pool.query('DELETE FROM baby_events WHERE id = $1 RETURNING id', [id]);
      if (result.rowCount === 0) {
        throw new Error('Event not found');
      }
      return true;
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  },

  // Update an event
  async update(id, type, amount = null, sleepStartTime = null, sleepEndTime = null, subtype = null, timestamp = null) {
    try {
      if (useMemoryStore) {
        const index = findMemoryEventIndexById(id);
        if (index === -1) {
          throw new Error('Event not found');
        }
        const updates = {
          type,
          amount,
          sleep_start_time: ensureMemoryTimestamp(sleepStartTime),
          sleep_end_time: ensureMemoryTimestamp(sleepEndTime),
          subtype
        };

        const normalizedTimestamp = ensureMemoryTimestamp(timestamp);
        if (normalizedTimestamp) {
          updates.timestamp = normalizedTimestamp;
        }
        return updateMemoryEvent(index, updates);
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'UPDATE baby_events SET type = $1, amount = $2, sleep_start_time = $3, sleep_end_time = $4, subtype = $5, timestamp = COALESCE($6, timestamp) WHERE id = $7 RETURNING *',
        [type, amount, sleepStartTime, sleepEndTime, subtype, timestamp, id]
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
  resetMemoryStore,
  withTransaction,
  pool
};