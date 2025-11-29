const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, Event, BabyProfile, withTransaction } = require('./database');
const DeepSeekEnhancedAnalyzer = require('./deepseek_analyzer');
const axios = require('axios');

// Input validation constants
// Enhanced validation functions
function validateEventType(type) {
  const ALLOWED_EVENT_TYPES = ['milk', 'poo', 'diaper', 'bath', 'sleep'];
  if (!ALLOWED_EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type: ${type}. Must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}`);
  }
}

function validateUserName(userName) {
  const ALLOWED_USERS = ['Charie', 'Angie', 'Tim', 'Mengyu'];
  if (!ALLOWED_USERS.includes(userName)) {
    throw new Error(`Invalid user: ${userName}. Must be one of: ${ALLOWED_USERS.join(', ')}`);
  }
}

function validateDiaperSubtype(subtype) {
  const ALLOWED_DIAPER_SUBTYPES = ['pee', 'poo', 'both'];
  if (subtype && !ALLOWED_DIAPER_SUBTYPES.includes(subtype)) {
    throw new Error(`Invalid diaper subtype: ${subtype}. Must be one of: ${ALLOWED_DIAPER_SUBTYPES.join(', ')}`);
  }
}

function validateMilkAmount(amount) {
  const MAX_MILK_AMOUNT = 500;
  if (amount <= 0 || amount > MAX_MILK_AMOUNT) {
    throw new Error(`Milk amount must be between 1 and ${MAX_MILK_AMOUNT} ml`);
  }
}

function validateSleepDuration(duration) {
  const MAX_SLEEP_DURATION = 480;
  if (duration <= 0 || duration > MAX_SLEEP_DURATION) {
    throw new Error(`Sleep duration must be between 1 and ${MAX_SLEEP_DURATION} minutes`);
  }
}

function validateTimestamp(timestamp) {
  const TIMESTAMP_MAX_PAST_DAYS = 365;
  const maxPastDate = new Date();
  maxPastDate.setDate(maxPastDate.getDate() - TIMESTAMP_MAX_PAST_DAYS);

  const eventDate = new Date(timestamp);
  if (Number.isNaN(eventDate.getTime())) {
    throw new Error('Invalid timestamp format');
  }
  if (eventDate > new Date()) {
    throw new Error('Event timestamp cannot be in the future');
  }
  if (eventDate < maxPastDate) {
    throw new Error(`Event timestamp cannot be more than ${TIMESTAMP_MAX_PAST_DAYS} days in the past`);
  }
}

// Enhanced sleep validation functions
function validateSleepTimes(sleepStart, sleepEnd) {
  if (!sleepStart || !sleepEnd) {
    throw new Error('Both sleep start and end times are required');
  }

  const start = new Date(sleepStart);
  const end = new Date(sleepEnd);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid sleep time format');
  }

  if (end <= start) {
    throw new Error('Sleep end time must be after sleep start time');
  }

  // Prevent sleep sessions longer than 12 hours (likely data error)
  const maxSleepHours = 12;
  const maxDuration = maxSleepHours * 60 * 60 * 1000; // 12 hours in milliseconds
  if ((end - start) > maxDuration) {
    throw new Error(`Sleep duration cannot exceed ${maxSleepHours} hours`);
  }

  // Prevent sleep sessions in the future
  const now = new Date();
  if (start > now || end > now) {
    throw new Error('Sleep times cannot be in the future');
  }
}

// Sleep duration verification - prompts user confirmation for unusual durations
function verifySleepDuration(duration) {
  const MIN_SLEEP_DURATION = 10; // 10 minutes
  const MAX_UNCONFIRMED_DURATION = 300; // 5 hours

  if (duration < MIN_SLEEP_DURATION) {
    return {
      requiresConfirmation: true,
      message: `Sleep duration is only ${duration} minutes. This is very short for a sleep session. Are you sure this is correct?`,
      duration: duration,
      issue: 'too_short'
    };
  }

  if (duration > MAX_UNCONFIRMED_DURATION) {
    return {
      requiresConfirmation: true,
      message: `Sleep duration is ${Math.round(duration/60*10)/10} hours. This is quite long for a sleep session. Are you sure this is correct?`,
      duration: duration,
      issue: 'too_long'
    };
  }

  return {
    requiresConfirmation: false,
    message: null,
    duration: duration,
    issue: null
  };
}

// Check if user can start a new sleep session (no existing incomplete sleep)
async function canStartNewSleep(userName) {
  const { Event } = require('./database');
  const incompleteSleep = await Event.getLastIncompleteSleep(userName);

  if (incompleteSleep) {
    throw new Error(`Cannot start new sleep session. User ${userName} already has an incomplete sleep session (started at ${incompleteSleep.sleep_start_time})`);
  }

  return true;
}

const CONSTANTS = {
  ALLOWED_EVENT_TYPES: ['milk', 'poo', 'diaper', 'bath', 'sleep'],
  ALLOWED_DIAPER_SUBTYPES: ['pee', 'poo', 'both'],
  ALLOWED_USERS: ['Charie', 'Angie', 'Tim', 'Mengyu'],
  VALIDATION: {
    MAX_FILTER_LENGTH: 1000,
    MAX_MILK_AMOUNT: 500,
    MAX_SLEEP_DURATION: 480,
    TIMESTAMP_MAX_PAST_DAYS: 365
  },
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 100
  },
  DB_POOL: {
    MAX: 20,
    IDLE_TIMEOUT_MS: 30000,
    CONNECTION_TIMEOUT_MS: 2000
  }
};
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOME_TIMEZONE = process.env.BABY_HOME_TIMEZONE || 'Asia/Hong_Kong';

const app = express();
const PORT = process.env.PORT || 3000;

// AI insights scheduling and caching
const INSIGHTS_CACHE_TTL_MS = 23 * 60 * 60 * 1000; // refresh roughly once a day
const INSIGHTS_REFRESH_HOUR = 3; // 03:00 server local time
const INSIGHTS_INVALIDATION_THRESHOLD = 10; // Invalidate cache after N new events
let insightsCache = {
  payload: null,
  generatedAt: null,
  refreshing: false,
  eventCountAtGeneration: 0,
  cacheKey: null  // Track goal/concerns for cache invalidation
};
const MANUAL_REFRESH_COOLDOWN_MS = parseInt(process.env.DEEPSEEK_REFRESH_COOLDOWN_MS || `${5 * 60 * 1000}`, 10);
let lastManualRefreshAt = 0;

// Generate cache key from goal/concerns
function getInsightsCacheKey(goal, concerns) {
  const normalizedGoal = (goal || '').trim().toLowerCase();
  const concernsArray = Array.isArray(concerns) ? concerns : [];
  const normalizedConcerns = concernsArray.map(c => (c || '').trim().toLowerCase()).filter(Boolean).sort().join(',');
  return `${normalizedGoal}|${normalizedConcerns}`;
}

// Track current event count for cache invalidation
async function shouldInvalidateInsightsCache(cacheKey) {
  if (!insightsCache.generatedAt) return true;
  // Invalidate if goal/concerns changed
  if (cacheKey && insightsCache.cacheKey !== cacheKey) return true;
  try {
    const events = await Event.getAll();
    const newEventCount = events.length - insightsCache.eventCountAtGeneration;
    return newEventCount >= INSIGHTS_INVALIDATION_THRESHOLD;
  } catch {
    return false;
  }
}

// Trust proxy for Railway deployment (required for rate limiting)
app.set('trust proxy', 1);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT.WINDOW_MS,
  max: CONSTANTS.RATE_LIMIT.MAX_REQUESTS,
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

function isInsightsCacheStale() {
  if (!insightsCache.generatedAt) {
    return true;
  }
  const cacheAgeMs = Date.now() - new Date(insightsCache.generatedAt).getTime();
  return cacheAgeMs > INSIGHTS_CACHE_TTL_MS;
}

async function checkDeepSeekHealth() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 400, error: 'DEEPSEEK_API_KEY not set' };
  }

  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [{ role: 'user', content: 'healthcheck' }],
      max_tokens: 1,
      temperature: 0
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    });

    const ok = response.status >= 200 && response.status < 300;
    return { ok, status: response.status };
  } catch (err) {
    const status = err?.response?.status || 500;
    if (status === 401 || status === 403) {
      return { ok: false, status, error: 'DeepSeek key rejected' };
    }
    return { ok: false, status, error: err.message || 'DeepSeek health check failed' };
  }
}

async function getBabyAgeWeeks(defaultWeeks = 8) {
  let ageWeeks = defaultWeeks;

  try {
    const profile = await BabyProfile.getProfile();
    if (profile && profile.date_of_birth) {
      const birthDate = new Date(profile.date_of_birth);
      const today = new Date();
      const diffTime = Math.abs(today - birthDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      ageWeeks = Math.floor(diffDays / 7);
    }
  } catch (profileError) {
    console.log('Could not get baby profile for age calculation, using default:', profileError.message);
  }

  return ageWeeks;
}

async function generateAndCacheInsights(reason = 'on-demand', options = {}) {
  if (insightsCache.refreshing) {
    return insightsCache.payload;
  }

  insightsCache.refreshing = true;
  const apiKey = process.env.DEEPSEEK_API_KEY || null;
  console.log(`[AI Insights] Generating insights (reason: ${reason}), API key present: ${!!apiKey}, key prefix: ${apiKey ? apiKey.substring(0, 8) + '...' : 'none'}`);

  try {
    // Parallel fetch for better performance
    const [events, ageWeeks, profileData] = await Promise.all([
      Event.getAll(),
      getBabyAgeWeeks(parseInt(process.env.DEFAULT_BABY_AGE_WEEKS || '8', 10)),
      (async () => {
        try {
          const [profile, latestMeasurement] = await Promise.all([
            BabyProfile.getProfile(),
            BabyProfile.getLatestMeasurement()
          ]);
          return { profile, latestMeasurement };
        } catch (profileErr) {
          console.log('[AI Insights] Unable to load profile/measurement:', profileErr.message);
          return { profile: null, latestMeasurement: null };
        }
      })()
    ]);
    const { profile, latestMeasurement } = profileData;
    console.log(`[AI Insights] Events: ${events.length}, Age: ${ageWeeks} weeks`);
    const analyzer = new DeepSeekEnhancedAnalyzer(
      events,
      HOME_TIMEZONE,
      apiKey,
      {
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: process.env.DEEPSEEK_TEMPERATURE,
        maxTokens: process.env.DEEPSEEK_MAX_TOKENS,
        goal: options.goal,
        concerns: options.concerns,
        lookbackDays: process.env.DEEPSEEK_LOOKBACK_DAYS
      }
    );

    const insights = await analyzer.generateEnhancedInsights({
      ageWeeks,
      profile,
      latestMeasurement,
      homeTimezone: HOME_TIMEZONE,
      goal: options.goal,
      concerns: options.concerns
    });
    const payload = {
      success: true,
      ...insights,
      generatedAt: new Date().toISOString(),
      ageUsed: ageWeeks,
      reason
    };

    insightsCache.payload = payload;
    insightsCache.generatedAt = payload.generatedAt;
    insightsCache.eventCountAtGeneration = events.length;
    insightsCache.cacheKey = getInsightsCacheKey(options.goal, options.concerns);
    return payload;
  } catch (error) {
    console.error('AI insights generation failed:', error);
    const isAuthError = error && (error.code === 'DEEPSEEK_AUTH' || error.message === 'DEEPSEEK_AUTH');
    const payload = {
      success: false,
      error: isAuthError ? 'DeepSeek API key rejected or unauthorized' : 'AI insights temporarily unavailable',
      message: isAuthError ? 'Please check DEEPSEEK_API_KEY and permissions' : 'Please try again later',
      generatedAt: new Date().toISOString(),
      authError: isAuthError
    };
    insightsCache.payload = payload;
    insightsCache.generatedAt = payload.generatedAt;
    return payload;
  } finally {
    insightsCache.refreshing = false;
  }
}

function getNextInsightsRefreshDelay() {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(INSIGHTS_REFRESH_HOUR, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  return nextRun.getTime() - now.getTime();
}

let dailyRefreshTimer = null;

function scheduleDailyAIInsights() {
  const scheduleNext = () => {
    const delay = getNextInsightsRefreshDelay();
    dailyRefreshTimer = setTimeout(async () => {
      await generateAndCacheInsights('scheduled');
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

function clearDailyRefreshTimer() {
  if (dailyRefreshTimer) {
    clearTimeout(dailyRefreshTimer);
    dailyRefreshTimer = null;
  }
}

async function getEventsHandler(req, res) {
  try {
    const { filter } = req.query;
    const rawType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const typeFilter = rawType && rawType !== 'all' ? rawType : '';

    if (typeFilter && !CONSTANTS.ALLOWED_EVENT_TYPES.includes(typeFilter)) {
      return res.status(400).json({
        error: `Invalid event type. Allowed types: ${CONSTANTS.ALLOWED_EVENT_TYPES.join(', ')}`
      });
    }

    let events;

    if (filter) {
      if (typeof filter !== 'string') {
        return res.status(400).json({ error: 'Invalid filter format' });
      }

      if (filter.length > CONSTANTS.VALIDATION.MAX_FILTER_LENGTH) {
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

// Get AI-enhanced insights
app.get('/api/ai-insights', async (req, res) => {
  try {
    const forceRefresh = req.query.force === '1' || req.query.force === 'true';
    const goal = typeof req.query.goal === 'string' ? req.query.goal : null;
    const concerns = typeof req.query.concerns === 'string'
      ? req.query.concerns.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const cacheKey = getInsightsCacheKey(goal, concerns);
    const hasMissingKeyError = insightsCache.payload?.aiEnhanced?.missingApiKey === true;
    const newDataInvalidation = await shouldInvalidateInsightsCache(cacheKey);
    const shouldRegenerate = forceRefresh || !insightsCache.payload || isInsightsCacheStale() ||
      (insightsCache.payload && insightsCache.payload.success === false) || hasMissingKeyError || newDataInvalidation;

    console.log(`[AI Insights] force=${forceRefresh}, cached=${!!insightsCache.payload}, stale=${isInsightsCacheStale()}, cacheKeyMatch=${insightsCache.cacheKey === cacheKey}, shouldRegenerate=${shouldRegenerate}`);

    const payload = shouldRegenerate
      ? await generateAndCacheInsights('api', { goal, concerns })
      : insightsCache.payload;

    res.status(payload && payload.success ? 200 : 503).json(payload);
  } catch (error) {
    console.error('AI insights error:', error);
    res.status(500).json({
      success: false,
      error: 'AI insights temporarily unavailable',
      message: 'Please try again later'
    });
  }
});

// Manual refresh endpoint with token + cooldown
app.post('/api/ai-insights/refresh', async (req, res) => {
  try {
    const refreshToken = process.env.DEEPSEEK_REFRESH_TOKEN || null;
    if (!refreshToken) {
      return res.status(404).json({ success: false, error: 'Manual refresh not enabled' });
    }

    const tokenFromRequest = req.headers['x-refresh-token'] || req.query.token;
    if (tokenFromRequest !== refreshToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const now = Date.now();
    if (lastManualRefreshAt && (now - lastManualRefreshAt) < MANUAL_REFRESH_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - (now - lastManualRefreshAt)) / 1000);
      return res.status(429).json({
        success: false,
        error: `Please wait ${waitSeconds}s before triggering another refresh`
      });
    }

    lastManualRefreshAt = now;
    const payload = await generateAndCacheInsights('manual');
    res.status(payload && payload.success ? 200 : 503).json(payload);
  } catch (error) {
    console.error('Manual AI refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'AI insights refresh failed',
      message: 'Please try again later'
    });
  }
});

// Health check for DeepSeek API key
app.get('/api/ai-insights/health', async (req, res) => {
  try {
    const result = await checkDeepSeekHealth();
    const status = result.status || (result.ok ? 200 : 503);
    res.status(status).json({
      success: result.ok,
      status,
      error: result.error || null
    });
  } catch (error) {
    console.error('AI health check error:', error);
    res.status(500).json({
      success: false,
      error: 'AI health check failed'
    });
  }
});

// Create a new event
app.post('/api/events', async (req, res) => {
  try {
    console.log('Received event creation request:', req.body);
    const { type, amount, userName, sleepSubType, sleepStartTime, sleepEndTime, diaperSubtype, timestamp } = req.body;

    // Enhanced validation using validation functions
    try {
      if (!type) throw new Error('Event type is required');
      validateEventType(type);

      if (!userName) throw new Error('User name is required');
      validateUserName(userName);

      if (timestamp) {
        validateTimestamp(timestamp);
      }

      if (type === 'diaper' && diaperSubtype) {
        validateDiaperSubtype(diaperSubtype);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // Validate timestamp if provided
    let eventTimestamp = null;
    if (timestamp) {
      const parsedTimestamp = new Date(timestamp);
      eventTimestamp = parsedTimestamp.toISOString();
    }

    if (type === 'milk') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount)) {
        return res.status(400).json({ error: 'Milk amount must be a valid number' });
      }

      try {
        validateMilkAmount(parsedAmount);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    // Validate diaper subtype
    if (type === 'diaper') {
      if (!diaperSubtype) {
        return res.status(400).json({ error: 'Diaper subtype is required (pee, poo, or both)' });
      }
      if (!CONSTANTS.ALLOWED_DIAPER_SUBTYPES.includes(diaperSubtype)) {
        return res.status(400).json({
          error: `Invalid diaper subtype. Allowed subtypes: ${CONSTANTS.ALLOWED_DIAPER_SUBTYPES.join(', ')}`
        });
      }
    }

    // Handle sleep events with fall asleep/wake up tracking
    let calculatedAmount = null;
    let sleepStart = null;
    let sleepEnd = null;

    if (type === 'sleep') {
      if (sleepSubType === 'fall_asleep') {
        // Create fall_asleep within a transaction to prevent race conditions
        try {
          const result = await withTransaction(async (client) => {
            // Check for existing incomplete sleep with FOR UPDATE lock
            const incompleteSleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

            if (incompleteSleep) {
              return {
                success: false,
                error: `Cannot start new sleep session. User ${userName} already has an incomplete sleep session (started at ${incompleteSleep.sleep_start_time})`
              };
            }

            sleepStart = eventTimestamp || new Date().toISOString();

            // Create the event within the same transaction
            const event = await Event.createWithClient(
              client,
              type,
              null, // amount
              userName,
              sleepStart,
              null, // sleepEnd
              null, // subtype
              eventTimestamp
            );

            return { success: true, event };
          });

          if (!result.success) {
            return res.status(400).json({ error: result.error });
          }

          // Return the created event
          return res.status(201).json(result.event);
        } catch (error) {
          console.error('Failed to create fall_asleep event:', error);
          return res.status(500).json({ error: 'Failed to create sleep session' });
        }
      } else if (sleepSubType === 'wake_up') {
        sleepEnd = eventTimestamp || new Date().toISOString();

        // Complete sleep session within a transaction to prevent race conditions
        try {
          const result = await withTransaction(async (client) => {
            const lastFallAsleep = await Event.getLastIncompleteSleepForUpdate(
              userName,
              client
            );

            if (!lastFallAsleep) {
              return { success: false, error: 'No fall asleep event found' };
            }

            sleepStart = lastFallAsleep.sleep_start_time;

            // Validate sleep times before calculating duration
            try {
              validateSleepTimes(sleepStart, sleepEnd);
            } catch (validationError) {
              return { success: false, error: validationError.message };
            }

            const duration = Math.round(
              (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
            );
            calculatedAmount = duration > 0 ? duration : 1;

            // Verify sleep duration for unusual values
            const verification = verifySleepDuration(calculatedAmount);
            if (verification.requiresConfirmation) {
              return {
                success: false,
                error: verification.message,
                requiresConfirmation: true,
                verification: verification
              };
            }

            // Update within the transaction
            const updateResult = await client.query(
              `UPDATE baby_events
               SET amount = $1, sleep_end_time = $2
               WHERE id = $3
               RETURNING *`,
              [calculatedAmount, sleepEnd, lastFallAsleep.id]
            );

            return {
              success: true,
              event: updateResult.rows[0],
              original: lastFallAsleep
            };
          });

          if (!result.success) {
            if (result.requiresConfirmation) {
              return res.status(422).json({
                error: result.error,
                requiresConfirmation: true,
                verification: result.verification
              });
            }
            return res.status(400).json({ error: result.error });
          }

          // Return the completed sleep event
          return res.status(201).json({
            ...result.original,
            amount: calculatedAmount,
            sleep_end_time: sleepEnd,
            ...result.event
          });
        } catch (error) {
          console.error('Failed to complete wake-up:', error);

          // Handle specific error types with appropriate status codes
          if (error.name === 'ConcurrentUpdateError') {
            return res.status(409).json({
              error: 'Sleep session was already completed by another request',
              code: 'CONCURRENT_UPDATE'
            });
          } else if (error.name === 'TransactionError') {
            return res.status(500).json({
              error: 'Transaction failed, please try again',
              code: 'TRANSACTION_ERROR'
            });
          } else if (error.name === 'DatabaseError') {
            return res.status(500).json({
              error: 'Database error occurred',
              code: 'DATABASE_ERROR'
            });
          }

          // Generic error
          return res.status(500).json({
            error: 'Failed to complete sleep session',
            code: 'INTERNAL_ERROR'
          });
        }
      } else {
        // Legacy sleep event with manual duration
        if (!amount || amount <= 0 || amount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
          return res.status(400).json({
            error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
          });
        }
        calculatedAmount = parseInt(amount);

        // Verify sleep duration for unusual values
        const verification = verifySleepDuration(calculatedAmount);
        if (verification.requiresConfirmation) {
          return res.status(422).json({
            error: verification.message,
            requiresConfirmation: true,
            verification: verification
          });
        }
      }
    } else {
      calculatedAmount = type === 'milk' ? parseInt(amount) : null;
      // Additional validation after parsing for milk events
      if (type === 'milk' && (isNaN(calculatedAmount) || calculatedAmount <= 0 || calculatedAmount > CONSTANTS.VALIDATION.MAX_MILK_AMOUNT)) {
        return res.status(400).json({
          error: `Milk amount must be between 1 and ${CONSTANTS.VALIDATION.MAX_MILK_AMOUNT} ml`
        });
      }

      // Check for incomplete sleep WITHIN a transaction to prevent race conditions
      if (type !== 'sleep') {
        try {
          await withTransaction(async (client) => {
            const incompleteSleep = await Event.getLastIncompleteSleepForUpdate(
              userName,
              client
            );

            if (incompleteSleep) {
              const sleepEnd = eventTimestamp || new Date().toISOString();
              const sleepStart = incompleteSleep.sleep_start_time;

              // Validate sleep times before auto-completion
              try {
                validateSleepTimes(sleepStart, sleepEnd);
              } catch (validationError) {
                console.error('Auto-completion validation failed:', validationError.message);
                return; // Skip auto-completion if validation fails
              }

              const duration = Math.round(
                (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
              );
              const sleepAmount = duration > 0 ? duration : 1;

              // Verify sleep duration for unusual values (log only, don't block auto-completion)
              const verification = verifySleepDuration(sleepAmount);
              if (verification.requiresConfirmation) {
                console.warn(
                  `⚠️ Auto-completed sleep event ${incompleteSleep.id} has unusual duration: ${sleepAmount} minutes`,
                  `(${verification.issue}) - ${verification.message}`
                );
              }

              // Update within the transaction
              await client.query(
                `UPDATE baby_events
                 SET amount = $1, sleep_end_time = $2
                 WHERE id = $3`,
                [sleepAmount, sleepEnd, incompleteSleep.id]
              );

              console.log(
                `Auto-completed sleep event ${incompleteSleep.id} ` +
                `with ${type} event at ${sleepEnd}`
              );
            }
          });
        } catch (error) {
          // If transaction fails (e.g., concurrent update), log but don't fail the request
          console.error(
            'Failed to auto-complete sleep (concurrent update):',
            error.message
          );
        }
      }
    }

    // Determine the subtype to store
    let eventSubtype = null;
    if (type === 'diaper') {
      eventSubtype = diaperSubtype;
    }
    // For backward compatibility, also support old "poo" type by converting to diaper with poo subtype
    if (type === 'poo') {
      eventSubtype = 'poo';
    }

    console.log('Creating event with data:', { type, calculatedAmount, userName, sleepStart, sleepEnd, subtype: eventSubtype, timestamp: eventTimestamp });
    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd, eventSubtype, eventTimestamp);
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
    const eventId = parseInt(id, 10);
    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    await Event.delete(eventId);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    if (error.message === 'Event not found') {
      res.status(404).json({ error: 'Event not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete event' });
    }
  }
});

// Update an event
async function updateEventHandler(req, res) {
  try {
    const { id } = req.params;
    const { type, amount, diaperSubtype, timestamp } = req.body;

    const eventId = parseInt(id, 10);

    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    if (!type) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    if (!CONSTANTS.ALLOWED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({
        error: `Invalid event type. Allowed types: ${CONSTANTS.ALLOWED_EVENT_TYPES.join(', ')}`
      });
    }

    const existingEvent = await Event.getById(eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    let normalizedAmount = null;
    let normalizedTimestamp = null;

    if (type === 'milk') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > CONSTANTS.VALIDATION.MAX_MILK_AMOUNT) {
        return res.status(400).json({
          error: `Milk amount is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_MILK_AMOUNT} ml`
        });
      }
      normalizedAmount = parsedAmount;
    } else if (type === 'sleep') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
        return res.status(400).json({
          error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
        });
      }
      normalizedAmount = parsedAmount;
    }

    if (timestamp !== undefined) {
      if (!timestamp) {
        return res.status(400).json({ error: 'Timestamp is required when provided' });
      }

      const parsedTimestamp = new Date(timestamp);
      if (Number.isNaN(parsedTimestamp.getTime())) {
        return res.status(400).json({ error: 'Invalid timestamp format' });
      }
      if (parsedTimestamp > new Date()) {
        return res.status(400).json({ error: 'Timestamp cannot be in the future' });
      }
      normalizedTimestamp = parsedTimestamp.toISOString();
    }

    // Validate diaper subtype if type is diaper
    let eventSubtype = null;
    if (type === 'diaper') {
      if (!diaperSubtype) {
        return res.status(400).json({ error: 'Diaper subtype is required (pee, poo, or both)' });
      }
      if (!CONSTANTS.ALLOWED_DIAPER_SUBTYPES.includes(diaperSubtype)) {
        return res.status(400).json({
          error: `Invalid diaper subtype. Allowed subtypes: ${CONSTANTS.ALLOWED_DIAPER_SUBTYPES.join(', ')}`
        });
      }
      eventSubtype = diaperSubtype;
    } else if (type === 'poo') {
      // Backward compatibility
      eventSubtype = 'poo';
    }

    const isSleepEvent = type === 'sleep';
    const existingSleepStart = existingEvent.sleep_start_time ?? existingEvent.sleepStartTime ?? null;
    const existingSleepEnd = existingEvent.sleep_end_time ?? existingEvent.sleepEndTime ?? null;
    const existingTimestamp = existingEvent.timestamp ? new Date(existingEvent.timestamp).toISOString() : null;

    let updatedSleepStart = null;
    let updatedSleepEnd = null;

    let timestampForUpdate = normalizedTimestamp || existingTimestamp;

    if (isSleepEvent) {
      const baseSleepStart = normalizedTimestamp || existingSleepStart || existingTimestamp;
      updatedSleepStart = baseSleepStart;

      const durationMinutes = normalizedAmount ?? (Number.isFinite(existingEvent.amount) ? Number(existingEvent.amount) : null);
      if (baseSleepStart && Number.isFinite(durationMinutes)) {
        const calculatedEnd = new Date(baseSleepStart);
        calculatedEnd.setMinutes(calculatedEnd.getMinutes() + durationMinutes);
        updatedSleepEnd = calculatedEnd.toISOString();
      } else if (existingSleepEnd) {
        updatedSleepEnd = existingSleepEnd;
      } else {
        updatedSleepEnd = null;
      }

      timestampForUpdate = normalizedTimestamp || baseSleepStart || existingTimestamp;
    }

    const event = await Event.update(
      eventId,
      type,
      normalizedAmount,
      updatedSleepStart,
      updatedSleepEnd,
      eventSubtype,
      timestampForUpdate
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

// Baby Profile API endpoints

// Get baby profile
app.get('/api/baby-profile', async (req, res) => {
  try {
    const profile = await BabyProfile.getProfile();
    const latestMeasurement = await BabyProfile.getLatestMeasurement();

    // Calculate age from DOB
    let ageWeeks = null;
    let ageDays = null;
    if (profile && profile.date_of_birth) {
      const birthDate = new Date(profile.date_of_birth);
      const today = new Date();
      const diffTime = Math.abs(today - birthDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      ageWeeks = Math.floor(diffDays / 7);
      ageDays = diffDays % 7;
    }

    res.json({
      success: true,
      profile: profile || null,
      latestMeasurement: latestMeasurement || null,
      age: profile ? {
        weeks: ageWeeks,
        days: ageDays,
        totalDays: ageWeeks * 7 + ageDays
      } : null
    });
  } catch (error) {
    console.error('Error getting baby profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get baby profile'
    });
  }
});

// Save baby profile
app.post('/api/baby-profile', async (req, res) => {
  try {
    const { name, dateOfBirth } = req.body;

    if (!name || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        error: 'Name and date of birth are required'
      });
    }

    // Validate date of birth
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date of birth format'
      });
    }

    // Check if date is in the future
    if (dob > new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Date of birth cannot be in the future'
      });
    }

    const profile = await BabyProfile.saveProfile(name, dateOfBirth);
    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error('Error saving baby profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save baby profile'
    });
  }
});

// Add baby measurement
app.post('/api/baby-measurements', async (req, res) => {
  try {
    const { measurementDate, weightKg, heightCm, headCircumferenceCm, notes } = req.body;

    if (!measurementDate) {
      return res.status(400).json({
        success: false,
        error: 'Measurement date is required'
      });
    }

    // Validate measurement date
    const measureDate = new Date(measurementDate);
    if (isNaN(measureDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid measurement date format'
      });
    }

    // Check if date is in the future
    if (measureDate > new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Measurement date cannot be in the future'
      });
    }

    const measurement = await BabyProfile.addMeasurement(
      measurementDate,
      weightKg || null,
      heightCm || null,
      headCircumferenceCm || null,
      notes || null
    );

    res.json({
      success: true,
      measurement
    });
  } catch (error) {
    console.error('Error adding baby measurement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add baby measurement'
    });
  }
});

// Get baby measurements
app.get('/api/baby-measurements', async (req, res) => {
  try {
    const measurements = await BabyProfile.getMeasurements();
    res.json({
      success: true,
      measurements
    });
  } catch (error) {
    console.error('Error getting baby measurements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get baby measurements'
    });
  }
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    homeTimezone: HOME_TIMEZONE
  });
});

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

    // Always return 200 OK if server is running, even if DB is not connected yet
    // This prevents Railway from killing the process during startup
    res.status(200).json({
      status: dbConnected ? 'OK' : 'STARTING',
      message: 'Baby Tracker API is running',
      database: dbConnected ? 'Connected' : 'Disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Return 200 with error details instead of 500
    // This allows Railway to keep the service alive during DB initialization
    res.status(200).json({
      status: 'STARTING',
      message: 'Baby Tracker API is running',
      database: 'Initializing',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    // Check if DATABASE_URL is set before starting
    if (!process.env.DATABASE_URL) {
      console.error('⚠️  WARNING: DATABASE_URL environment variable is not set!');
      console.error('⚠️  Database features will NOT work.');
      console.error('⚠️  To fix this in Railway:');
      console.error('⚠️    1. Go to your Railway project dashboard');
      console.error('⚠️    2. Click "+ New" → "Database" → "PostgreSQL"');
      console.error('⚠️    3. Railway will automatically set DATABASE_URL');
      console.error('⚠️    4. Redeploy your application');
      console.error('');
    }

    // Start server immediately (don't wait for DB init to complete)
    // This prevents Railway timeout during startup
    server = app.listen(PORT, () => {
      console.log(`🚀 Baby Tracker server running on port ${PORT}`);
      console.log(`📱 Open http://localhost:${PORT} to view the app`);
      if (!process.env.DATABASE_URL) {
        console.log(`⚠️  Server started but DATABASE is NOT connected`);
      }
    });

    // Warm AI insights cache and schedule daily refresh
    generateAndCacheInsights('startup').catch((error) => {
      console.error('AI insights warm-up failed:', error);
    });
    scheduleDailyAIInsights();

    // Initialize database in background
    setTimeout(async () => {
      try {
        if (process.env.DATABASE_URL) {
          await initializeDatabase();
          console.log(`🗄️  Database initialized successfully`);
          // Refresh AI insights after DB is ready
          generateAndCacheInsights('post-db').catch((err) => {
            console.error('AI insights refresh after DB init failed:', err);
          });
        } else {
          console.log(`⚠️  Skipping database initialization - DATABASE_URL not set`);
        }
      } catch (error) {
        console.error('❌ Failed to initialize database:', error);
        console.error('❌ Please check your DATABASE_URL configuration');
        // Don't exit - server can still serve frontend and show error in health check
      }
    }, 100);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Endpoint to create confirmed sleep events (bypasses duration verification)
app.post('/api/events/confirmed-sleep', async (req, res) => {
  try {
    console.log('Received confirmed sleep event creation request:', req.body);
    const { type, amount, userName, sleepSubType, sleepStartTime, sleepEndTime, timestamp } = req.body;

    // Basic validation (skip duration verification since it's confirmed)
    if (!type || type !== 'sleep') {
      return res.status(400).json({ error: 'Event type must be sleep' });
    }

    if (!userName) {
      return res.status(400).json({ error: 'User name is required' });
    }

    validateUserName(userName);

    if (timestamp) {
      validateTimestamp(timestamp);
    }

    // Handle sleep events
    let calculatedAmount = null;
    let sleepStart = null;
    let sleepEnd = null;

    if (sleepSubType === 'fall_asleep') {
      // Create fall_asleep within a transaction to prevent race conditions
      try {
        const result = await withTransaction(async (client) => {
          const incompleteSleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

          if (incompleteSleep) {
            return {
              success: false,
              error: `Cannot start new sleep session. User ${userName} already has an incomplete sleep session (started at ${incompleteSleep.sleep_start_time})`
            };
          }

          sleepStart = timestamp || new Date().toISOString();

          const event = await Event.createWithClient(
            client,
            'sleep',
            null,
            userName,
            sleepStart,
            null,
            null,
            timestamp
          );

          return { success: true, event };
        });

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        return res.status(201).json(result.event);
      } catch (error) {
        console.error('Failed to create confirmed fall_asleep event:', error);
        return res.status(500).json({ error: 'Failed to create sleep session', details: error.message });
      }
    } else if (sleepSubType === 'wake_up') {
      sleepEnd = timestamp || new Date().toISOString();

      // Complete sleep session within a transaction
      try {
        const result = await withTransaction(async (client) => {
          const lastFallAsleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

          if (!lastFallAsleep) {
            return { success: false, error: 'No fall asleep event found' };
          }

          sleepStart = lastFallAsleep.sleep_start_time;

          // Validate sleep times (but skip duration verification)
          try {
            validateSleepTimes(sleepStart, sleepEnd);
          } catch (validationError) {
            return { success: false, error: validationError.message };
          }

          const duration = Math.round(
            (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
          );
          calculatedAmount = duration > 0 ? duration : 1;

          // Update within the transaction
          const updateResult = await client.query(
            `UPDATE baby_events
             SET amount = $1, sleep_end_time = $2
             WHERE id = $3
             RETURNING *`,
            [calculatedAmount, sleepEnd, lastFallAsleep.id]
          );

          return {
            success: true,
            event: updateResult.rows[0],
            original: lastFallAsleep
          };
        });

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        // Return the completed sleep event
        return res.status(201).json({
          ...result.original,
          amount: calculatedAmount,
          sleep_end_time: sleepEnd,
          ...result.event
        });
      } catch (error) {
        console.error('Failed to complete confirmed wake-up:', error);
        return res.status(500).json({ error: 'Failed to complete sleep session' });
      }
    } else {
      // Legacy sleep event with manual duration
      if (!amount || amount <= 0 || amount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
        return res.status(400).json({
          error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
        });
      }
      calculatedAmount = parseInt(amount);
    }

    // Create the confirmed sleep event
    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd, null, timestamp);
    console.log('Confirmed sleep event created successfully:', event);
    res.status(201).json(event);

  } catch (error) {
    console.error('❌ Error creating confirmed sleep event:', error);
    res.status(500).json({ error: 'Failed to create confirmed sleep event' });
  }
});

// Server instance - only used when running as main module
let server = null;

if (require.main === module) {
  // Graceful shutdown handling - only register when running as main module
  // (not when imported by tests or other modules)
  function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    // Clear scheduled timers to prevent memory leaks
    clearDailyRefreshTimer();
    if (server) {
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
      // Force close after 10 seconds
      setTimeout(() => {
        console.log('Forcing shutdown...');
        process.exit(0);
      }, 10000);
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  startServer();
}

module.exports = {
  app,
  startServer,
  getEventsHandler,
  updateEventHandler
};
