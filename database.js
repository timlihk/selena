const { Pool } = require('pg');
require('dotenv').config();

// Database connection configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
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
    console.error('❌ Database initialization error:', error);
  }
}

// Event operations
const Event = {
  // Get all events
  async getAll() {
    try {
      const result = await pool.query(
        'SELECT * FROM baby_events ORDER BY timestamp DESC'
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting events:', error);
      throw error;
    }
  },

  // Create a new event
  async create(type, amount = null) {
    try {
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
      await pool.query('DELETE FROM baby_events WHERE id = $1', [id]);
      return true;
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  }
};

module.exports = {
  pool,
  initializeDatabase,
  Event
};