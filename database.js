const { Pool } = require('pg');
require('dotenv').config();
const config = require('./config');

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

// Timezone configuration - imported from centralized config
const HOME_TIMEZONE = config.HOME_TIMEZONE;
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

// Validate DATABASE_URL format
function validateDatabaseUrl(url) {
  if (!url) {return { valid: false, error: 'DATABASE_URL is not set' };}

  // Check for valid PostgreSQL URL patterns
  const validPatterns = [
    /^postgres(ql)?:\/\/.+/i,  // postgres:// or postgresql://
  ];

  const isValidFormat = validPatterns.some(pattern => pattern.test(url));
  if (!isValidFormat) {
    return {
      valid: false,
      error: `Invalid DATABASE_URL format. Expected: postgresql://user:password@host:port/database, got: ${url.substring(0, 20)}...`
    };
  }

  // Check for common issues
  if (url.includes(' ')) {
    return { valid: false, error: 'DATABASE_URL contains spaces - check for copy/paste errors' };
  }

  if (!url.includes('@')) {
    return { valid: false, error: 'DATABASE_URL missing @ symbol - check format: postgresql://user:password@host:port/database' };
  }

  return { valid: true };
}

// Initialize pool only when DATABASE_URL is available
try {
  if (!useMemoryStore) {
    const validation = validateDatabaseUrl(process.env.DATABASE_URL);
    if (!validation.valid) {
      console.error(`❌ Database URL validation failed: ${validation.error}`);
      throw new Error(validation.error);
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      // Add connection timeout and retry settings
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 20
    });
    console.log('✅ Database pool initialized successfully');
  } else {
    console.warn('⚠️  DATABASE_URL is not set. Falling back to in-memory data store (not for production use).');
  }
} catch (error) {
  console.error('Database pool initialization failed:', error.message);
  // Don't throw - allow server to start with memory fallback
  if (!useMemoryStore) {
    console.warn('⚠️  Falling back to in-memory data store due to database error');
  }
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
    // Enhanced memory store transaction simulation with actual data mutation
    // Snapshot memoryStore at BEGIN for rollback support
    let transactionState = 'idle';
    let memorySnapshot = null;
    let memoryIdCounterSnapshot = null;

    const transactionClient = {
      query: async (text, params = []) => {
        const normalizedText = text.trim().toUpperCase();

        // Handle transaction control statements
        if (normalizedText === 'BEGIN') {
          // Take a deep snapshot of current state for potential rollback
          memorySnapshot = memoryStore.map(event => ({ ...event }));
          memoryIdCounterSnapshot = memoryIdCounter;
          transactionState = 'active';
          return { rows: [] };
        } else if (normalizedText === 'COMMIT') {
          // Clear snapshot - changes are permanent
          memorySnapshot = null;
          memoryIdCounterSnapshot = null;
          transactionState = 'committed';
          return { rows: [] };
        } else if (normalizedText === 'ROLLBACK') {
          // Restore snapshot - revert all changes made during transaction
          if (memorySnapshot !== null) {
            memoryStore = memorySnapshot;
            memoryIdCounter = memoryIdCounterSnapshot;
          }
          memorySnapshot = null;
          memoryIdCounterSnapshot = null;
          transactionState = 'rolled_back';
          return { rows: [] };
        }

        // Only allow queries when transaction is active
        if (transactionState !== 'active') {
          throw new Error(`Transaction is ${transactionState}, cannot execute query`);
        }

        // Handle UPDATE queries for memory store
        if (normalizedText.startsWith('UPDATE BABY_EVENTS')) {
          // Parse UPDATE baby_events SET ... WHERE id = $N RETURNING *
          // Extract the id from params (last param in WHERE id = $N pattern)
          const whereIdMatch = text.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
          if (whereIdMatch) {
            const idParamIndex = parseInt(whereIdMatch[1], 10) - 1;
            const eventId = params[idParamIndex];
            const index = findMemoryEventIndexById(eventId);

            if (index === -1) {
              return { rows: [], rowCount: 0 };
            }

            // Parse SET clause to extract field updates
            const setMatch = text.match(/SET\s+(.+?)\s+WHERE/is);
            if (setMatch) {
              const updates = {};
              const setClause = setMatch[1];
              // Match patterns like "amount = $1" or "sleep_end_time = $2"
              const fieldMatches = setClause.matchAll(/(\w+)\s*=\s*\$(\d+)/gi);
              for (const match of fieldMatches) {
                const fieldName = match[1].toLowerCase();
                const paramIndex = parseInt(match[2], 10) - 1;
                let value = params[paramIndex];
                // Normalize timestamps
                if (fieldName.includes('time') && value) {
                  value = ensureMemoryTimestamp(value);
                }
                updates[fieldName] = value;
              }

              const updatedEvent = updateMemoryEvent(index, updates);
              return { rows: [updatedEvent], rowCount: 1 };
            }
          }
          return { rows: [], rowCount: 0 };
        }

        // Handle SELECT queries for memory store
        if (normalizedText.startsWith('SELECT')) {
          // Handle simple SELECT 1 style queries for testing
          if (normalizedText.match(/^SELECT\s+\d+/)) {
            const numMatch = text.match(/SELECT\s+(\d+)\s+(?:AS\s+(\w+))?/i);
            if (numMatch) {
              const value = parseInt(numMatch[1], 10);
              const alias = numMatch[2] || 'value';
              return { rows: [{ [alias]: value }] };
            }
          }
          // For FOR UPDATE queries on sleep events, delegate to Event methods
          if (normalizedText.includes('FOR UPDATE')) {
            // This is handled by Event.getLastIncompleteSleepForUpdate
            return { rows: [] };
          }
          return { rows: [] };
        }

        // Default: return empty for other query types
        return { rows: [] };
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

      // Create baby profile table
      await client.query(`
        CREATE TABLE IF NOT EXISTS baby_profile (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          date_of_birth DATE NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create baby measurements table for tracking weight/height history
      await client.query(`
        CREATE TABLE IF NOT EXISTS baby_measurements (
          id SERIAL PRIMARY KEY,
          measurement_date DATE NOT NULL,
          weight_kg DECIMAL(4,2),
          height_cm DECIMAL(4,1),
          head_circumference_cm DECIMAL(4,1),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

function eventOverlapWithDay(event, dayStart, dayEnd) {
  if (event.type === 'sleep' && event.sleep_start_time) {
    const sleepStart = new Date(event.sleep_start_time);
    if (Number.isNaN(sleepStart.getTime())) {
      return false;
    }

    let sleepEnd = event.sleep_end_time ? new Date(event.sleep_end_time) : new Date();
    if (Number.isNaN(sleepEnd.getTime())) {
      sleepEnd = new Date();
    }

    return sleepStart <= dayEnd && sleepEnd >= dayStart;
  }

  const eventTimestamp = new Date(event.timestamp);
  if (Number.isNaN(eventTimestamp.getTime())) {
    return false;
  }

  return eventTimestamp >= dayStart && eventTimestamp <= dayEnd;
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
        query += ` WHERE ${  conditions.join(' AND ')}`;
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

  // Create a new event within a transaction (accepts client for transaction safety)
  async createWithClient(client, type, amount = null, userName = 'Unknown', sleepStartTime = null, sleepEndTime = null, subtype = null, timestamp = null) {
    try {
      if (useMemoryStore) {
        return createMemoryEvent(type, amount, userName, sleepStartTime, sleepEndTime, subtype, timestamp);
      }

      const result = await client.query(
        'INSERT INTO baby_events (type, amount, user_name, sleep_start_time, sleep_end_time, subtype, timestamp) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP)) RETURNING *',
        [type, amount, userName, sleepStartTime, sleepEndTime, subtype, timestamp]
      );
      return result.rows[0];
    } catch (error) {
      console.error('❌ Database error creating event with client:', error);
      throw error;
    }
  },

  // Get today's events
  async getTodayStats() {
    try {
      const now = new Date();
      const todayStartLocal = new Date(now.toLocaleString('en-US', { timeZone: HOME_TIMEZONE }));
      todayStartLocal.setHours(0, 0, 0, 0);
      const todayEndLocal = new Date(todayStartLocal);
      todayEndLocal.setHours(23, 59, 59, 999);

      if (useMemoryStore) {
        const statsAccumulator = memoryStore.reduce((acc, event) => {
          if (!eventOverlapWithDay(event, todayStartLocal, todayEndLocal)) {
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
      const result = await pool.query(`
        WITH bounds AS (
          SELECT
            DATE_TRUNC('day', NOW() AT TIME ZONE $1) AS today_start_tz,
            DATE_TRUNC('day', NOW() AT TIME ZONE $1) + INTERVAL '24 hours' - INTERVAL '1 millisecond' AS today_end_tz
        )
        SELECT
          COUNT(CASE WHEN b.type = 'milk' AND DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1) THEN 1 END) as milk_count,
          COUNT(CASE WHEN b.type IN ('poo', 'diaper') AND DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1) THEN 1 END) as diaper_count,
          COUNT(CASE WHEN b.type = 'bath' AND DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1) THEN 1 END) as bath_count,
          COUNT(CASE WHEN b.type = 'sleep' AND (
            DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR DATE(b.sleep_start_time AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR DATE(b.sleep_end_time AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR (b.sleep_start_time AT TIME ZONE $1 < DATE_TRUNC('day', NOW() AT TIME ZONE $1)
                AND (b.sleep_end_time IS NULL OR b.sleep_end_time AT TIME ZONE $1 >= DATE_TRUNC('day', NOW() AT TIME ZONE $1)))
          ) THEN 1 END) as sleep_count,
          COALESCE(SUM(CASE WHEN b.type = 'milk' AND DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1) THEN b.amount ELSE 0 END), 0) as total_milk,
          COALESCE(SUM(CASE WHEN b.type = 'sleep' AND (
            DATE(b.timestamp AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR DATE(b.sleep_start_time AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR DATE(b.sleep_end_time AT TIME ZONE $1) = DATE(NOW() AT TIME ZONE $1)
            OR (b.sleep_start_time AT TIME ZONE $1 < DATE_TRUNC('day', NOW() AT TIME ZONE $1)
                AND (b.sleep_end_time IS NULL OR b.sleep_end_time AT TIME ZONE $1 >= DATE_TRUNC('day', NOW() AT TIME ZONE $1)))
          ) THEN b.amount ELSE 0 END), 0) as total_sleep_minutes
        FROM baby_events b
        CROSS JOIN bounds
        WHERE
          b.timestamp >= bounds.today_start_tz - INTERVAL '1 day'
          OR (b.sleep_start_time IS NOT NULL AND b.sleep_start_time >= bounds.today_start_tz - INTERVAL '1 day')
          OR (b.sleep_end_time IS NOT NULL AND b.sleep_end_time >= bounds.today_start_tz - INTERVAL '1 day')
      `, [HOME_TIMEZONE]);

      const row = result.rows[0] || {};

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

// Baby Profile operations
const BabyProfile = {
  // Get baby profile
  async getProfile() {
    try {
      if (useMemoryStore) {
        // Memory store implementation for baby profile
        const profile = memoryStore.find(item => item._type === 'baby_profile');
        return profile ? cloneEvent(profile) : null;
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'SELECT * FROM baby_profile ORDER BY id DESC LIMIT 1'
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting baby profile:', error);
      throw error;
    }
  },

  // Create or update baby profile
  async saveProfile(name, dateOfBirth) {
    try {
      if (useMemoryStore) {
        // Remove existing profile if any
        const existingIndex = memoryStore.findIndex(item => item._type === 'baby_profile');
        if (existingIndex !== -1) {
          memoryStore.splice(existingIndex, 1);
        }

        const profile = {
          _type: 'baby_profile',
          id: memoryIdCounter++,
          name,
          date_of_birth: dateOfBirth,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        memoryStore.push(profile);
        return cloneEvent(profile);
      }

      ensureDatabaseConnected();

      // Check if profile exists
      const existingProfile = await pool.query(
        'SELECT id FROM baby_profile ORDER BY id DESC LIMIT 1'
      );

      if (existingProfile.rows.length > 0) {
        // Update existing profile
        const result = await pool.query(
          'UPDATE baby_profile SET name = $1, date_of_birth = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
          [name, dateOfBirth, existingProfile.rows[0].id]
        );
        return result.rows[0];
      }
        // Create new profile
        const result = await pool.query(
          'INSERT INTO baby_profile (name, date_of_birth) VALUES ($1, $2) RETURNING *',
          [name, dateOfBirth]
        );
        return result.rows[0];

    } catch (error) {
      console.error('Error saving baby profile:', error);
      throw error;
    }
  },

  // Add baby measurement
  async addMeasurement(measurementDate, weightKg, heightCm, headCircumferenceCm, notes) {
    try {
      if (useMemoryStore) {
        const measurement = {
          _type: 'baby_measurement',
          id: memoryIdCounter++,
          measurement_date: measurementDate,
          weight_kg: weightKg,
          height_cm: heightCm,
          head_circumference_cm: headCircumferenceCm,
          notes,
          created_at: new Date().toISOString()
        };
        memoryStore.push(measurement);
        return cloneEvent(measurement);
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'INSERT INTO baby_measurements (measurement_date, weight_kg, height_cm, head_circumference_cm, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [measurementDate, weightKg, heightCm, headCircumferenceCm, notes]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error adding baby measurement:', error);
      throw error;
    }
  },

  // Get all baby measurements
  async getMeasurements() {
    try {
      if (useMemoryStore) {
        return memoryStore
          .filter(item => item._type === 'baby_measurement')
          .sort((a, b) => new Date(b.measurement_date) - new Date(a.measurement_date))
          .map(cloneEvent);
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'SELECT * FROM baby_measurements ORDER BY measurement_date DESC'
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting baby measurements:', error);
      throw error;
    }
  },

  // Get latest measurement
  async getLatestMeasurement() {
    try {
      if (useMemoryStore) {
        const measurements = memoryStore
          .filter(item => item._type === 'baby_measurement')
          .sort((a, b) => new Date(b.measurement_date) - new Date(a.measurement_date));
        return measurements.length > 0 ? cloneEvent(measurements[0]) : null;
      }

      ensureDatabaseConnected();
      const result = await pool.query(
        'SELECT * FROM baby_measurements ORDER BY measurement_date DESC LIMIT 1'
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting latest measurement:', error);
      throw error;
    }
  }
};

module.exports = {
  pool,
  initializeDatabase,
  Event,
  BabyProfile,
  testConnection,
  resetMemoryStore,
  withTransaction
};
