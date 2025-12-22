const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, Event, BabyProfile } = require('./database');
const { DeepSeekEnhancedAnalyzer, PatternDetector } = require('./deepseek_analyzer');
const axios = require('axios');
const config = require('./config');
const { buildAnalytics } = require('./services/analytics');
const eventsRouter = require('./routes/events');
const { getEventsHandler, updateEventHandler } = eventsRouter;
const profileRouter = require('./routes/profile');
const apiError = require('./lib/apiError');
const logger = require('./lib/logger');

// Input validation constants - imported from centralized config
const ALLOWED_USERS = config.ALLOWED_USERS;
const ALLOWED_EVENT_TYPES = config.ALLOWED_EVENT_TYPES;
const ALLOWED_DIAPER_SUBTYPES = config.ALLOWED_DIAPER_SUBTYPES;

// Use centralized config - CONSTANTS kept for backward compatibility with existing code
const CONSTANTS = {
  ALLOWED_EVENT_TYPES: config.ALLOWED_EVENT_TYPES,
  ALLOWED_DIAPER_SUBTYPES: config.ALLOWED_DIAPER_SUBTYPES,
  ALLOWED_USERS: config.ALLOWED_USERS,
  VALIDATION: config.VALIDATION,
  RATE_LIMIT: config.RATE_LIMIT,
  DB_POOL: config.DB_POOL
};
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOME_TIMEZONE = config.HOME_TIMEZONE;

const app = express();
const PORT = config.PORT;

// AI insights scheduling and caching - from centralized config
const INSIGHTS_CACHE_TTL_MS = config.INSIGHTS_CACHE.TTL_MS;
const INSIGHTS_REFRESH_HOUR = config.INSIGHTS_CACHE.REFRESH_HOUR;
const INSIGHTS_INVALIDATION_THRESHOLD = config.INSIGHTS_CACHE.INVALIDATION_THRESHOLD;
const INSIGHTS_FAILURE_TTL_MS = config.INSIGHTS_CACHE.FAILURE_TTL_MS;
const insightsCache = {
  payload: null,
  generatedAt: null,
  refreshing: false,
  eventCountAtGeneration: 0,
  cacheKey: null  // Track goal/concerns for cache invalidation
};
const MANUAL_REFRESH_COOLDOWN_MS = config.DEEPSEEK.REFRESH_COOLDOWN_MS;
let lastManualRefreshAt = 0;

function getEventDaysCount(events) {
  const days = new Set();
  events.forEach(evt => {
    const ts = evt.timestamp || evt.sleep_start_time || evt.sleep_end_time;
    if (!ts) {return;}
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {return;}
    days.add(d.toISOString().slice(0, 10));
  });
  return days.size;
}

// Generate cache key from goal/concerns
function getInsightsCacheKey(goal, concerns) {
  const normalizedGoal = (goal || '').trim().toLowerCase();
  const concernsArray = Array.isArray(concerns) ? concerns : [];
  const normalizedConcerns = concernsArray.map(c => (c || '').trim().toLowerCase()).filter(Boolean).sort().join(',');
  return `${normalizedGoal}|${normalizedConcerns}`;
}

// Track current event count for cache invalidation
async function shouldInvalidateInsightsCache(cacheKey) {
  if (!insightsCache.generatedAt) {return true;}
  // Invalidate if goal/concerns changed
  if (cacheKey && insightsCache.cacheKey !== cacheKey) {return true;}
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
  // Use shorter TTL for failures - either top-level failure OR nested AI error
  const hasError = insightsCache.payload && (
    insightsCache.payload.success === false ||
    insightsCache.payload.aiEnhanced?.error ||
    insightsCache.payload.aiEnhanced?.apiError ||
    insightsCache.payload.aiEnhanced?.missingApiKey
  );
  const ttl = hasError ? INSIGHTS_FAILURE_TTL_MS : INSIGHTS_CACHE_TTL_MS;
  return cacheAgeMs > ttl;
}

function buildActionPlans(aiEnhanced, analytics = null) {
  const insights = aiEnhanced?.insights || [];
  const plans = insights.slice(0, 3).map((insight, idx) => ({
    title: insight.title || `Focus ${idx + 1}`,
    steps: [
      insight.recommendation || insight.description || 'Monitor and adjust as needed.'
    ],
    priority: insight.priority || 3
  }));

  // Add a schedule nudge if available
  if (aiEnhanced?.miniPlan?.tonightBedtimeTarget) {
    plans.unshift({
      title: 'Tonight’s Plan',
      steps: [
        `Bedtime target: ${aiEnhanced.miniPlan.tonightBedtimeTarget}`,
        ...(aiEnhanced.miniPlan.nextWakeWindows || [])
      ],
      priority: 2
    });
  } else if (analytics?.sleepQuality?.recommendedHours) {
    plans.push({
      title: 'Sleep baseline',
      steps: [`Aim for ${analytics.sleepQuality.recommendedHours}h total today.`],
      priority: 3
    });
  }

  return plans.slice(0, 4);
}

function buildAlertExplanations(realtimeAlerts = []) {
  return realtimeAlerts.map(alert => ({
    title: alert.title || 'Alert',
    explanation: alert.message || alert.note || 'Check recent events.',
    severity: alert.severity || 'info'
  }));
}

function buildScheduleSuggestion(aiEnhanced, analytics = null) {
  if (aiEnhanced?.miniPlan) {
    return {
      bedtime: aiEnhanced.miniPlan.tonightBedtimeTarget || '',
      wakeWindows: aiEnhanced.miniPlan.nextWakeWindows || [],
      feedingNote: aiEnhanced.miniPlan.feedingNote || ''
    };
  }

  const wakeWindows = analytics?.sleepQuality?.wakeWindows || [];
  return {
    bedtime: '',
    wakeWindows,
    feedingNote: ''
  };
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
    logger.log('Could not get baby profile for age calculation, using default:', profileError.message);
  }

  return ageWeeks;
}

// Track in-flight generation promise to avoid race conditions
let insightsGenerationPromise = null;

// Timeout wrapper for async operations
const AI_INSIGHTS_TIMEOUT_MS = config.INSIGHTS_CACHE.TIMEOUT_MS;

function withTimeout(promise, ms, operation = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function generateAndCacheInsights(reason = 'on-demand', options = {}) {
  // If already generating, wait for the same result instead of returning stale data
  if (insightsCache.refreshing && insightsGenerationPromise) {
    logger.log('[AI Insights] Generation in progress, waiting for result...');
    return insightsGenerationPromise;
  }

  insightsCache.refreshing = true;

  // Create a promise that other callers can wait on
  insightsGenerationPromise = (async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY || null;
  logger.log(`[AI Insights] Generating insights (reason: ${reason}), API key present: ${!!apiKey}, key prefix: ${apiKey ? `${apiKey.substring(0, 8)  }...` : 'none'}`);

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
          logger.log('[AI Insights] Unable to load profile/measurement:', profileErr.message);
          return { profile: null, latestMeasurement: null };
        }
      })()
    ]);
    const { profile, latestMeasurement } = profileData;
    logger.log(`[AI Insights] Events: ${events.length}, Age: ${ageWeeks} weeks`);
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

    const insights = await withTimeout(
      analyzer.generateEnhancedInsights({
        ageWeeks,
        profile,
        latestMeasurement,
        homeTimezone: HOME_TIMEZONE,
        goal: options.goal,
        concerns: options.concerns
      }),
      AI_INSIGHTS_TIMEOUT_MS,
      'AI insights generation'
    );

    // Run real-time pattern detection (no AI, immediate safety alerts)
    const patternDetector = new PatternDetector(events, HOME_TIMEZONE, ageWeeks);
    const realtimeAlerts = patternDetector.detectAnomalies();
    logger.log(`[AI Insights] Real-time alerts detected: ${realtimeAlerts.length}`);

    const analytics = buildAnalytics ? await buildAnalytics(events, HOME_TIMEZONE) : null;

    const payload = {
      success: true,
      ...insights,
      realtimeAlerts, // Immediate safety alerts (no AI)
      generatedAt: new Date().toISOString(),
      ageUsed: ageWeeks,
      reason,
      actionPlans: buildActionPlans(insights.aiEnhanced, analytics),
      alertExplanations: buildAlertExplanations(realtimeAlerts),
      scheduleSuggestion: buildScheduleSuggestion(insights.aiEnhanced, analytics),
      dataQuality: insights.dataQuality,
      weeklyTrends: analytics?.weeklyTrends || null
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
      authError: isAuthError,
      actionPlans: [],
      alertExplanations: [],
      scheduleSuggestion: null,
      dataQuality: null
    };
    insightsCache.payload = payload;
    insightsCache.generatedAt = payload.generatedAt;
    return payload;
  } finally {
    insightsCache.refreshing = false;
    insightsGenerationPromise = null;
  }
  })();

  return insightsGenerationPromise;
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

// API Routes

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

    logger.log(`[AI Insights] force=${forceRefresh}, cached=${!!insightsCache.payload}, stale=${isInsightsCacheStale()}, cacheKeyMatch=${insightsCache.cacheKey === cacheKey}, shouldRegenerate=${shouldRegenerate}`);

    let payload = shouldRegenerate
      ? await generateAndCacheInsights('api', { goal, concerns })
      : insightsCache.payload;

    // Merge alert explanations into smartAlerts for tooltip rendering
    if (payload?.alertExplanations && Array.isArray(payload.alertExplanations) && Array.isArray(payload.smartAlerts)) {
      const explanationsMap = new Map();
      payload.alertExplanations.forEach(item => {
        const titleKey = (item.title || '').toLowerCase();
        const typeKey = (item.type || '').toLowerCase();
        const messageKey = (item.message || '').toLowerCase();
        if (titleKey) {explanationsMap.set(`title:${titleKey}`, item.explanation);}
        if (typeKey) {explanationsMap.set(`type:${typeKey}`, item.explanation);}
        if (messageKey) {explanationsMap.set(`msg:${messageKey}`, item.explanation);}
      });

      payload.smartAlerts = payload.smartAlerts.map(alert => {
        if (alert.explanation) {return alert;}
        const titleKey = `title:${(alert.title || '').toLowerCase()}`;
        const typeKey = `type:${(alert.type || '').toLowerCase()}`;
        const messageKey = `msg:${(alert.message || '').toLowerCase()}`;
        const explanation = explanationsMap.get(titleKey) ||
          explanationsMap.get(typeKey) ||
          explanationsMap.get(messageKey) ||
          null;
        return { ...alert, explanation };
      });
    }

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

// Grounded Q&A endpoint
app.get('/api/ai-insights/ask', async (req, res) => {
  try {
    const question = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!question) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }

    // Simple per-process rate limit: max 5 per minute
    const now = Date.now();
    if (!app.locals.askHistory) {
      app.locals.askHistory = [];
    }
    app.locals.askHistory = app.locals.askHistory.filter(ts => now - ts < 60_000);
    if (app.locals.askHistory.length >= 5) {
      return res.status(429).json({ success: false, error: 'Too many questions, please wait a minute.' });
    }
    app.locals.askHistory.push(now);

    // Per-process cache for identical questions within 10 minutes
    if (!app.locals.askCache) {
      app.locals.askCache = new Map();
    }
    // Drop stale cache entries to prevent unbounded growth
    const tenMinutesMs = 10 * 60 * 1000;
    for (const [key, value] of app.locals.askCache.entries()) {
      if (now - value.cachedAt >= tenMinutesMs) {
        app.locals.askCache.delete(key);
      }
    }

    const cacheKey = question.toLowerCase();
    const cached = app.locals.askCache.get(cacheKey);
    if (cached && (now - cached.cachedAt) < tenMinutesMs) {
      return res.json(cached.payload);
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, error: 'AI not configured' });
    }

    const events = await Event.getAll();
    const analytics = await buildAnalytics(events, HOME_TIMEZONE);
    const dataQuality = {
      days: getEventDaysCount(events),
      totalEvents: events.length,
      hasSufficientData: events.length >= 20
    };

    const summary = {
      feeding: analytics?.feedingIntelligence || null,
      sleep: analytics?.sleepQuality || null,
      diaper: analytics?.diaperHealth || null,
      smartAlerts: analytics?.smartAlerts || [],
      weeklyTrends: analytics?.weeklyTrends || null
    };

    const systemPrompt = [
      'You are a concise baby-tracking assistant.',
      'Use ONLY the provided stats; do not guess missing data.',
      'Be brief (<=120 words), use bullets when helpful.',
      'Surface concrete numbers and trends; avoid generic advice.',
      'If data is insufficient, say so.'
    ].join(' ');

    const userContent = `Question: ${question}\n\nContext (JSON): ${JSON.stringify(summary).slice(0, 4000)}`;

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 350,
      temperature: 0.2
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const answer = response?.data?.choices?.[0]?.message?.content || 'No answer available';
    const payload = {
      success: true,
      answer,
      dataQuality
    };
    app.locals.askCache.set(cacheKey, { cachedAt: now, payload });
    res.json(payload);
  } catch (error) {
    console.error('AI ask endpoint error:', error.message);
    res.status(503).json({
      success: false,
      error: 'AI question failed',
      details: error.message
    });
  }
});

// Events routes moved to routes/events.js
app.use('/api', eventsRouter);
app.use('/api', profileRouter);

// Server-side analytics to reduce client computation
app.get('/api/analytics/today', async (req, res) => {
  try {
    const events = await Event.getAll();
    const analytics = buildAnalytics(events, HOME_TIMEZONE);
    res.json({
      success: true,
      ...analytics
    });
  } catch (error) {
    console.error('Error building analytics:', error);
    apiError(res, 500, 'Failed to build analytics');
  }
});

// Event routes handled by routes/events.js

// Configuration endpoint - serves centralized app config to frontend
app.get('/api/config', (req, res) => {
  res.json({
    homeTimezone: HOME_TIMEZONE,
    users: ALLOWED_USERS,
    eventTypes: ALLOWED_EVENT_TYPES,
    diaperSubtypes: ALLOWED_DIAPER_SUBTYPES
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

// Server instance - declared before startServer to avoid ESLint no-use-before-define
let server = null;

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
        console.log('⚠️  Server started but DATABASE is NOT connected');
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
          console.log('🗄️  Database initialized successfully');
          // Refresh AI insights after DB is ready
          generateAndCacheInsights('post-db').catch((err) => {
            console.error('AI insights refresh after DB init failed:', err);
          });
        } else {
          console.log('⚠️  Skipping database initialization - DATABASE_URL not set');
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
