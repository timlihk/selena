// Centralized configuration for Baby Tracker
// All environment variables and defaults are defined here

const config = {
  // Timezone configuration - used for date boundaries and display
  // Default: Asia/Hong_Kong (can be overridden via BABY_HOME_TIMEZONE env var)
  HOME_TIMEZONE: process.env.BABY_HOME_TIMEZONE || 'Asia/Hong_Kong',

  // Server configuration
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',

  // Database configuration
  DATABASE_URL: process.env.DATABASE_URL || null,

  // DeepSeek AI configuration
  DEEPSEEK: {
    API_KEY: process.env.DEEPSEEK_API_KEY || null,
    MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    TEMPERATURE: parseFloat(process.env.DEEPSEEK_TEMPERATURE || '0.1'),
    // If not set, dynamic allocation based on data complexity will be used (600-1200 tokens)
    MAX_TOKENS: parseInt(process.env.DEEPSEEK_MAX_TOKENS || '1000', 10),
    REFRESH_TOKEN: process.env.DEEPSEEK_REFRESH_TOKEN || null,
    REFRESH_COOLDOWN_MS: parseInt(process.env.DEEPSEEK_REFRESH_COOLDOWN_MS || '300000', 10),
    LOOKBACK_DAYS: parseInt(process.env.DEEPSEEK_LOOKBACK_DAYS || '30', 10)
  },

  // Validation constants
  VALIDATION: {
    MAX_MILK_AMOUNT: 500,
    MAX_SLEEP_DURATION: 480,
    TIMESTAMP_MAX_PAST_DAYS: 365,
    MAX_FILTER_LENGTH: 1000
  },

  // Allowed values
  ALLOWED_USERS: ['Charie', 'Angie', 'Tim', 'Mengyu'],
  ALLOWED_EVENT_TYPES: ['milk', 'poo', 'diaper', 'bath', 'sleep'],
  ALLOWED_DIAPER_SUBTYPES: ['pee', 'poo', 'both'],

  // Rate limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 100
  },

  // Database pool settings
  DB_POOL: {
    MAX: 20,
    IDLE_TIMEOUT_MS: 30000,
    CONNECTION_TIMEOUT_MS: 2000
  },

  // AI Insights cache settings
  INSIGHTS_CACHE: {
    TTL_MS: 23 * 60 * 60 * 1000,           // 23 hours
    FAILURE_TTL_MS: 10 * 60 * 1000,        // 10 minutes for failures
    REFRESH_HOUR: 3,                        // 03:00 server local time
    INVALIDATION_THRESHOLD: 5,              // Invalidate after N new events
    TIMEOUT_MS: 60000                       // 60 seconds max for generation
  },

  // Baby age fallback
  DEFAULT_BABY_AGE_WEEKS: parseInt(process.env.DEFAULT_BABY_AGE_WEEKS || '8', 10)
};

module.exports = config;
