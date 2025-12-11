// DeepSeek Enhanced Pattern Analyzer for Advanced Baby Sleep Insights
const axios = require('axios');

class DeepSeekEnhancedAnalyzer {
    constructor(events, timezone, apiKey, options = {}) {
        this.events = events;
        this.timezone = timezone;
        this.apiKey = apiKey;
        this.apiBaseUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.minDataDays = 10; // allow preview with trimmed lookback
        this.model = options.model || 'deepseek-chat';
        // Lower temperature (0.1) for consistent, reliable medical advice
        this.temperature = Number.isFinite(parseFloat(options.temperature)) ? parseFloat(options.temperature) : 0.1;
        // Max tokens: prioritize insight quality over cost unless explicitly overridden.
        // If not provided, use a generous floor and scale up for complex histories.
        const parsedMaxTokens = (options.maxTokens === undefined || options.maxTokens === null || options.maxTokens === '')
            ? null
            : parseInt(options.maxTokens, 10);
        const calculatedTokens = this.calculateOptimalMaxTokens();
        const qualityFloor = 1500;
        this.maxTokens = Number.isFinite(parsedMaxTokens)
            ? parsedMaxTokens
            : Math.max(qualityFloor, calculatedTokens);
        // Token usage tracking
        this.lastTokenUsage = null;
        this.retries = Number.isFinite(parseInt(options.retries, 10)) ? parseInt(options.retries, 10) : 2;
        this.goal = options.goal || null;
        this.concerns = Array.isArray(options.concerns) ? options.concerns : [];
        this.lookbackDays = Number.isFinite(parseInt(options.lookbackDays, 10)) ? parseInt(options.lookbackDays, 10) : 30;
        this.rawEventLimit = Number.isFinite(parseInt(options.rawEventLimit, 10)) ? parseInt(options.rawEventLimit, 10) : 1000;
    }

    // Calculate optimal max_tokens based on data complexity
    calculateOptimalMaxTokens() {
        const eventCount = this.events.length;
        const dataDays = this.getDaysOfData();

        // Handle edge cases
        if (eventCount === 0 || dataDays === 0) {
            return 600;
        }

        const eventsPerDay = eventCount / dataDays;
        const isHighDensity = eventsPerDay > 20;

        // Primary decision based on data days
        if (dataDays < 7) {
            // Less than a week of data
            return isHighDensity ? 800 : 600;
        } else if (dataDays < 30) {
            // 1-4 weeks of data
            return (eventCount >= 150 || isHighDensity) ? 1000 : 800;
        } else {
            // More than 30 days
            return (eventCount >= 200) ? 1200 : 1000;
        }
    }

    hasSufficientData() {
        const days = this.getDaysOfData();
        return days >= this.minDataDays;
    }

    getDaysOfData() {
        return this.computeDays(this.events);
    }

    // Compute days from any event array (for full vs lookback comparison)
    computeDays(events) {
        if (!events || events.length === 0) {return 0;}
        const timestamps = events.map(e => new Date(e.timestamp).getTime());
        const oldest = Math.min(...timestamps);
        const newest = Math.max(...timestamps);
        return Math.floor((newest - oldest) / (1000 * 60 * 60 * 24)) + 1;
    }

    // Extract statistical patterns for AI enhancement
    extractStatisticalPatterns() {
        const { recentEvents, olderEventsSummary } = this.splitEventsByLookback();
        const originalEvents = this.events;
        const fullEvents = this.events;
        this.events = recentEvents;

        const patterns = {
            feedingToSleep: this.analyzeFeedingToSleep(),
            wakeWindows: this.analyzeWakeWindows(),
            sleepDistribution: this.analyzeSleepDistribution(),
            feedingPatterns: this.analyzeFeedingPatterns(),
            diaperPatterns: this.analyzeDiaperPatterns(),
            overallStats: this.getOverallStats(),
            olderSummary: olderEventsSummary
        };

        const sleepTotals = this.getSleepTotals(recentEvents);
        patterns.totalSleepMinutes = sleepTotals.totalMinutes;
        patterns.sleepDaysUsed = sleepTotals.daysUsed;
        patterns.recentEventsLimited = this.sliceRecentRawEvents(recentEvents);

        // For sufficiency, consider full history
        patterns.fullDataDays = this.computeDays(fullEvents);

        this.events = originalEvents;
        return patterns;
    }

    analyzeFeedingToSleep() {
        const sleepEvents = this.events.filter(e => e.type === 'sleep' && e.amount >= 10);
        const milkEvents = this.events.filter(e => e.type === 'milk');

        const correlations = [];
        for (const milk of milkEvents) {
            const milkTime = new Date(milk.timestamp);
            const followingSleep = sleepEvents.find(sleep => {
                const sleepTime = new Date(sleep.timestamp);
                const hoursDiff = (sleepTime - milkTime) / (1000 * 60 * 60);
                return hoursDiff > 0 && hoursDiff <= 4;
            });

            if (followingSleep) {
                correlations.push({
                    hoursFromFeedToSleep: (new Date(followingSleep.timestamp) - milkTime) / (1000 * 60 * 60),
                    sleepDuration: followingSleep.amount,
                    feedTime: milkTime.getHours()
                });
            }
        }

        return {
            totalCorrelations: correlations.length,
            byHour: this.groupByHour(correlations),
            avgSleepDuration: correlations.reduce((sum, c) => sum + c.sleepDuration, 0) / correlations.length || 0
        };
    }

    analyzeWakeWindows() {
        const sleepEvents = this.events.filter(e =>
            e.type === 'sleep' && e.amount >= 10 && e.sleep_start_time && e.sleep_end_time
        ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const wakeData = [];
        for (let i = 1; i < sleepEvents.length; i++) {
            const prevSleep = sleepEvents[i - 1];
            const currSleep = sleepEvents[i];

            const wakeStart = new Date(prevSleep.sleep_end_time);
            const wakeEnd = new Date(currSleep.timestamp);
            const wakeWindowHours = (wakeEnd - wakeStart) / (1000 * 60 * 60);

            if (wakeWindowHours >= 0.5 && wakeWindowHours <= 6) {
                wakeData.push({
                    wakeWindow: wakeWindowHours,
                    followingSleepDuration: currSleep.amount
                });
            }
        }

        return {
            totalTransitions: wakeData.length,
            byWindow: this.groupByWakeWindow(wakeData),
            avgWakeWindow: wakeData.reduce((sum, w) => sum + w.wakeWindow, 0) / wakeData.length || 0
        };
    }

    analyzeSleepDistribution() {
        const sleepEvents = this.events.filter(e => e.type === 'sleep' && e.amount >= 10);
        const byHour = {};

        sleepEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            if (!byHour[hour]) {byHour[hour] = [];}
            byHour[hour].push(event.amount);
        });

        return {
            totalSleepEvents: sleepEvents.length,
            byHour,
            avgSleepDuration: sleepEvents.reduce((sum, e) => sum + e.amount, 0) / sleepEvents.length || 0
        };
    }

    analyzeFeedingPatterns() {
        const milkEvents = this.events.filter(e => e.type === 'milk');
        const byHour = {};

        milkEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            if (!byHour[hour]) {byHour[hour] = [];}
            byHour[hour].push(event.amount);
        });

        return {
            totalFeeds: milkEvents.length,
            byHour,
            avgAmount: milkEvents.reduce((sum, e) => sum + e.amount, 0) / milkEvents.length || 0
        };
    }

    analyzeDiaperPatterns() {
        const diaperEvents = this.events.filter(e => e.type === 'diaper' || e.type === 'poo');
        const byHour = {};
        const byType = { pee: 0, poo: 0, both: 0 };

        diaperEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            if (!byHour[hour]) {byHour[hour] = [];}
            byHour[hour].push(event.subtype || 'pee');

            const subtype = event.subtype || 'pee';
            byType[subtype] = (byType[subtype] || 0) + 1;
        });

        return {
            totalDiapers: diaperEvents.length,
            byHour,
            byType
        };
    }

    getOverallStats() {
        const sleepEvents = this.events.filter(e => e.type === 'sleep' && e.amount >= 10);
        const milkEvents = this.events.filter(e => e.type === 'milk');
        const diaperEvents = this.events.filter(e => e.type === 'diaper' || e.type === 'poo');

        return {
            totalEvents: this.events.length,
            sleepEvents: sleepEvents.length,
            milkEvents: milkEvents.length,
            diaperEvents: diaperEvents.length,
            dataDays: this.getDaysOfData(),
            avgSleepPerDay: sleepEvents.length / this.getDaysOfData() || 0,
            avgFeedsPerDay: milkEvents.length / this.getDaysOfData() || 0
        };
    }

    splitEventsByLookback() {
        if (!this.lookbackDays || this.events.length === 0) {
            return { recentEvents: this.events, olderEventsSummary: null };
        }
        const cutoff = Date.now() - (this.lookbackDays * 24 * 60 * 60 * 1000);
        const recentEvents = this.events.filter(e => new Date(e.timestamp).getTime() >= cutoff);
        const olderEvents = this.events.filter(e => new Date(e.timestamp).getTime() < cutoff);

        const summarize = (evts) => {
            if (!evts || evts.length === 0) {return null;}
            const total = evts.length;
            const byType = evts.reduce((acc, e) => {
                acc[e.type] = (acc[e.type] || 0) + 1;
                return acc;
            }, {});
            const sleepAvg = this.averageAmountFor(evts, 'sleep');
            const milkAvg = this.averageAmountFor(evts, 'milk');
            const first = new Date(Math.min(...evts.map(e => new Date(e.timestamp).getTime()))).toISOString();
            const last = new Date(Math.max(...evts.map(e => new Date(e.timestamp).getTime()))).toISOString();
            return { total, byType, sleepAvg, milkAvg, first, last };
        };

        return {
            recentEvents,
            olderEventsSummary: summarize(olderEvents)
        };
    }

    averageAmountFor(events, type) {
        const filtered = events.filter(e => e.type === type && Number.isFinite(e.amount));
        if (!filtered.length) {return 0;}
        return Math.round(filtered.reduce((sum, e) => sum + e.amount, 0) / filtered.length);
    }

    groupByHour(correlations) {
        const byHour = {};
        correlations.forEach(c => {
            if (!byHour[c.feedTime]) {byHour[c.feedTime] = [];}
            byHour[c.feedTime].push(c.sleepDuration);
        });
        return byHour;
    }

    groupByWakeWindow(wakeData) {
        const byWindow = {};
        const WINDOW_SIZE_HOURS = 0.5;
        wakeData.forEach(w => {
            const windowKey = Math.floor(w.wakeWindow / WINDOW_SIZE_HOURS) * WINDOW_SIZE_HOURS;
            if (!byWindow[windowKey]) {byWindow[windowKey] = [];}
            byWindow[windowKey].push(w.followingSleepDuration);
        });
        return byWindow;
    }

    // Sanitize user input to prevent prompt injection
    sanitizePromptInput(input, maxLength = 200) {
        if (!input || typeof input !== 'string') {return '';}
        return input
            .replace(/[<>{}[\]]/g, '')      // Remove potential markup/code chars
            .replace(/[\r\n]+/g, ' ')        // Remove newlines
            .replace(/\s+/g, ' ')            // Normalize whitespace
            .trim()
            .substring(0, maxLength);
    }

    // Get age-appropriate recommendations based on pediatric guidelines
    getAgeBasedRecommendations(ageWeeks) {
        // Based on AAP and pediatric sleep guidelines
        if (ageWeeks <= 4) {
            return {
                sleepHoursMin: 14, sleepHoursMax: 17,
                wakeWindowMin: 0.5, wakeWindowMax: 1,
                feedsPerDayMin: 8, feedsPerDayMax: 12,
                feedAmountMin: 60, feedAmountMax: 90
            };
        } else if (ageWeeks <= 8) {
            return {
                sleepHoursMin: 14, sleepHoursMax: 17,
                wakeWindowMin: 1, wakeWindowMax: 1.5,
                feedsPerDayMin: 6, feedsPerDayMax: 10,
                feedAmountMin: 90, feedAmountMax: 120
            };
        } else if (ageWeeks <= 12) {
            return {
                sleepHoursMin: 14, sleepHoursMax: 16,
                wakeWindowMin: 1, wakeWindowMax: 2,
                feedsPerDayMin: 6, feedsPerDayMax: 8,
                feedAmountMin: 120, feedAmountMax: 150
            };
        } else if (ageWeeks <= 16) {
            return {
                sleepHoursMin: 13, sleepHoursMax: 15,
                wakeWindowMin: 1.5, wakeWindowMax: 2.5,
                feedsPerDayMin: 5, feedsPerDayMax: 7,
                feedAmountMin: 150, feedAmountMax: 180
            };
        } else if (ageWeeks <= 24) {
            return {
                sleepHoursMin: 12, sleepHoursMax: 15,
                wakeWindowMin: 2, wakeWindowMax: 3,
                feedsPerDayMin: 5, feedsPerDayMax: 6,
                feedAmountMin: 180, feedAmountMax: 210
            };
        }
            // 6+ months
            return {
                sleepHoursMin: 12, sleepHoursMax: 14,
                wakeWindowMin: 2.5, wakeWindowMax: 3.5,
                feedsPerDayMin: 4, feedsPerDayMax: 6,
                feedAmountMin: 180, feedAmountMax: 240
            };

    }

    // Calculate 7-day trends comparing recent week to prior week
    calculateTrends() {
        if (this.events.length < 14) {
            return { feeding: null, sleep: null, diaper: null };
        }

        const now = Date.now();
        const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);

        const recentWeek = this.events.filter(e => {
            const ts = new Date(e.timestamp).getTime();
            return ts >= oneWeekAgo && ts < now;
        });
        const priorWeek = this.events.filter(e => {
            const ts = new Date(e.timestamp).getTime();
            return ts >= twoWeeksAgo && ts < oneWeekAgo;
        });

        const calcAvg = (events, type, field = 'amount') => {
            const filtered = events.filter(e => e.type === type && Number.isFinite(e[field]));
            if (!filtered.length) {return null;}
            return filtered.reduce((sum, e) => sum + e[field], 0) / filtered.length;
        };

        const formatTrend = (recent, prior, unit) => {
            if (recent === null || prior === null || prior === 0) {return null;}
            const pctChange = ((recent - prior) / prior) * 100;
            const direction = pctChange > 5 ? '↑' : pctChange < -5 ? '↓' : '→';
            return `${direction} ${Math.abs(pctChange).toFixed(0)}% (${Math.round(prior)}${unit} → ${Math.round(recent)}${unit})`;
        };

        return {
            feeding: formatTrend(calcAvg(recentWeek, 'milk'), calcAvg(priorWeek, 'milk'), 'ml'),
            sleep: formatTrend(calcAvg(recentWeek, 'sleep'), calcAvg(priorWeek, 'sleep'), 'min'),
            diaper: formatTrend(
                recentWeek.filter(e => e.type === 'diaper').length / 7,
                priorWeek.filter(e => e.type === 'diaper').length / 7,
                '/day'
            )
        };
    }

    medianTimestampForType(field) {
        const values = this.events
            .map(e => e[field])
            .filter(Boolean)
            .map(v => new Date(v).getTime())
            .filter(t => !Number.isNaN(t))
            .sort((a, b) => a - b);
        if (!values.length) {return null;}
        const mid = Math.floor(values.length / 2);
        const ts = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
        return new Date(ts).toISOString();
    }

    medianFirstEventTime(type) {
        const firstPerDay = {};
        this.events
            .filter(e => e.type === type)
            .forEach(e => {
                const ts = new Date(e.timestamp);
                if (Number.isNaN(ts.getTime())) {return;}
                const day = ts.toISOString().split('T')[0];
                if (!firstPerDay[day] || ts < firstPerDay[day]) {
                    firstPerDay[day] = ts;
                }
            });
        const times = Object.values(firstPerDay).map(d => d.getTime()).sort((a, b) => a - b);
        if (!times.length) {return null;}
        const mid = Math.floor(times.length / 2);
        const ts = times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
        return new Date(ts).toISOString();
    }

    medianIntervalMinutes(type) {
        const sorted = this.events
            .filter(e => e.type === type)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        if (sorted.length < 2) {return null;}
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1].timestamp);
            const curr = new Date(sorted[i].timestamp);
            if (Number.isNaN(prev.getTime()) || Number.isNaN(curr.getTime())) {continue;}
            intervals.push((curr - prev) / (1000 * 60));
        }
        intervals.sort((a, b) => a - b);
        if (!intervals.length) {return null;}
        const mid = Math.floor(intervals.length / 2);
        return intervals.length % 2 === 0 ? (intervals[mid - 1] + intervals[mid]) / 2 : intervals[mid];
    }

    extremeAmount(type, mode = 'max') {
        const amounts = this.events
            .filter(e => e.type === type && Number.isFinite(e.amount))
            .map(e => e.amount);
        if (!amounts.length) {return null;}
        return mode === 'min' ? Math.min(...amounts) : Math.max(...amounts);
    }

    longestWakeWindowMinutes() {
        const sleeps = this.events
            .filter(e => e.type === 'sleep' && e.sleep_start_time && e.sleep_end_time)
            .sort((a, b) => new Date(a.sleep_start_time) - new Date(b.sleep_start_time));
        if (sleeps.length < 2) {return null;}
        let longest = 0;
        for (let i = 1; i < sleeps.length; i++) {
            const prevEnd = new Date(sleeps[i - 1].sleep_end_time);
            const currStart = new Date(sleeps[i].sleep_start_time);
            if (Number.isNaN(prevEnd.getTime()) || Number.isNaN(currStart.getTime())) {continue;}
            const gap = (currStart - prevEnd) / (1000 * 60);
            if (gap > longest) {longest = gap;}
        }
        return Math.round(longest);
    }

    // Sum amounts for a given event type
    sumAmountsByType(events, type) {
        return events
            .filter(e => e.type === type && Number.isFinite(e.amount))
            .reduce((sum, e) => sum + e.amount, 0);
    }

    getSleepTotals(events) {
        const dateKey = (ts) => new Intl.DateTimeFormat('en-CA', {
            timeZone: this.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date(ts));

        const todayKey = dateKey(Date.now());
        const totalsByDay = {};

        events
            .filter(e => e.type === 'sleep' && Number.isFinite(e.amount))
            .forEach(e => {
                const key = dateKey(e.timestamp || e.sleep_start_time || Date.now());
                totalsByDay[key] = (totalsByDay[key] || 0) + e.amount;
            });

        let daysUsed = 0;
        let totalMinutes = 0;
        Object.entries(totalsByDay).forEach(([key, minutes]) => {
            if (key === todayKey) {return;} // skip incomplete current day
            daysUsed += 1;
            totalMinutes += minutes;
        });

        // If excluding today leaves no days, fall back to using all days
        if (daysUsed === 0) {
            Object.values(totalsByDay).forEach(minutes => {
                daysUsed += 1;
                totalMinutes += minutes;
            });
        }

        return { totalMinutes, daysUsed };
    }

    // Slice recent events to rawEventLimit
    sliceRecentRawEvents(events) {
        return events.slice(-this.rawEventLimit);
    }

    // Core DeepSeek API integration
    async analyzeWithDeepSeek(context = {}) {
        const dataDays = context.fullDataDays || this.getDaysOfData();
        console.log(`[DeepSeek] Starting analysis: ${dataDays} days of data, API key: ${this.apiKey ? 'present' : 'MISSING'}, min required: ${this.minDataDays}`);

        if (dataDays < this.minDataDays) {
            console.log(`[DeepSeek] Insufficient data: ${dataDays} < ${this.minDataDays} days`);
            return {
                insights: [{
                    title: 'Need more data',
                    description: `AI insights unlock after ${this.minDataDays} days of tracking. You currently have ${dataDays} day(s). Keep logging feeds, sleep, and diapers to enable personalized guidance.`,
                    type: 'general',
                    confidence: 0.0,
                    recommendation: 'Continue tracking daily for at least two weeks.'
                }],
                error: null,
                dataDays,
                insufficientData: true
            };
        }

        if (!this.apiKey) {
            console.log('[DeepSeek] No API key configured');
            return {
                insights: [{
                    title: 'AI Insights Unavailable',
                    description: 'DeepSeek API key is not configured. Please contact the administrator to enable AI-powered insights.',
                    type: 'general',
                    confidence: 0.0,
                    recommendation: 'Add DEEPSEEK_API_KEY to environment variables to enable AI analysis.'
                }],
                error: 'DeepSeek API key not configured. Add DEEPSEEK_API_KEY to environment variables.',
                fallback: true,
                missingApiKey: true
            };
        }

        try {
            // Use precomputed patterns if provided, otherwise compute them
            const patterns = context.precomputedPatterns || this.extractStatisticalPatterns();
            const { systemPrompt, userContent } = this.buildDeepSeekPrompt(patterns, context);

            console.log('[DeepSeek] Calling API...');
            const response = await this.callDeepSeekAPI(systemPrompt, userContent);
            console.log('[DeepSeek] API response received, length:', response?.length || 0);
            const parsed = this.parseDeepSeekResponse(response, patterns);
            return this.sanitizeAIResponse(parsed);

        } catch (error) {
            if (error && (error.code === 'DEEPSEEK_AUTH' || error.message === 'DEEPSEEK_AUTH')) {
                throw error;
            }
            console.error('[DeepSeek] API error:', error.message);
            if (error.response) {
                console.error('[DeepSeek] Response status:', error.response.status);
                console.error('[DeepSeek] Response data:', JSON.stringify(error.response.data).substring(0, 500));
            }
            return {
                insights: [{
                    title: 'AI Analysis Temporarily Unavailable',
                    description: 'We encountered an issue connecting to the AI service. Your data is safe and the analysis will be available once the service recovers.',
                    type: 'general',
                    confidence: 0.0,
                    recommendation: 'Try refreshing the page in a few minutes.'
                }],
                error: `AI analysis failed: ${error.message}`,
                fallback: true,
                apiError: true
            };
        }
    }

    buildDeepSeekPrompt(patterns, context) {
        const ageWeeks = context.ageWeeks || 8;
        const ageLabel = `${ageWeeks}w`;
        const measurement = this.formatMeasurementCompact(context.latestMeasurement);

        // Sanitize user inputs
        const goal = this.sanitizePromptInput(context.goal || this.goal || '') || 'balanced development';
        const concerns = (context.concerns || this.concerns || [])
            .map(c => this.sanitizePromptInput(c, 50)).filter(Boolean);

        // Get age norms and trends
        const norms = this.getAgeBasedRecommendations(ageWeeks);
        const trends = this.calculateTrends();
        const days = patterns.overallStats.dataDays || 1; // Prevent division by zero

        // Compute key metrics for comparison (with NaN protection)
        const feedsPerDay = days > 0 ? (patterns.feedingPatterns.totalFeeds / days).toFixed(1) : '0';
        const avgFeedMl = Math.round(patterns.feedingPatterns.avgAmount || 0);
        const avgSleepMin = Math.round(patterns.sleepDistribution.avgSleepDuration || 0);
        const avgWakeMin = Math.round((patterns.wakeWindows.avgWakeWindow || 0) * 60);
        const diapersPerDay = days > 0 ? (patterns.diaperPatterns.totalDiapers / days).toFixed(1) : '0';
        const totalSleepMin = Math.round(patterns.totalSleepMinutes || 0);
        const sleepDays = patterns.sleepDaysUsed || days;
        const sleepHoursPerDay = sleepDays > 0 ? (totalSleepMin / sleepDays / 60).toFixed(1) : '0';

        const anchors = {
            medianBedtime: this.medianTimestampForType?.('sleep_start_time') || null,
            medianFirstNapStart: this.medianFirstEventTime?.('sleep') || null,
            medianFeedIntervalMinutes: this.medianIntervalMinutes?.('milk') || null
        };

        const extremes = {
            shortestNapMin: this.extremeAmount?.('sleep', 'min') || null,
            longestNapMin: this.extremeAmount?.('sleep', 'max') || null,
            longestWakeMinutes: this.longestWakeWindowMinutes?.() || null
        };

        const contextPayload = {
            profile: {
                ageWeeks,
                ageLabel,
                measurement,
                timezone: context.homeTimezone || this.timezone,
                goal,
                concerns
            },
            window: {
                days,
                lookbackDays: this.lookbackDays
            },
            norms,
            trends,
            anchors,
            extremes,
            stats: {
                feedsPerDay,
                avgFeedMl,
                avgSleepMin,
                avgWakeMin,
                diapersPerDay,
                sleepHoursPerDay,
                totalSleepMin,
                feedingPatterns: patterns.feedingPatterns,
                sleepDistribution: patterns.sleepDistribution,
                wakeWindows: patterns.wakeWindows,
                diaperPatterns: patterns.diaperPatterns
            },
            olderSummary: patterns.olderSummary || null,
            recentEvents: (context.recentEvents || []).slice(-this.rawEventLimit)
        };

        const systemPrompt = `You are a pediatric sleep/feeding coach. Follow this strict JSON schema. Return ONLY JSON. No markdown, no prose outside JSON. Avoid medical diagnosis; if red flags, advise contacting a pediatrician.

Critical rules to maximize usefulness and correctness:
1. Use ONLY the provided data and stats. Do NOT invent numbers, dates, or patterns. If unsure, say "no clear signal yet".
2. Every insight must reference specific evidence from the payload (e.g., "avgSleepMin=92", "feedsPerDay=7.5", "best hour 19:00 with n=12 samples").
3. Prefer 1–3 high‑impact insights over generic advice. Make them actionable for the next 24 hours.
4. If data is sparse or noisy, provide at most 1 low‑confidence insight + a clear logging suggestion.
5. Alerts are ONLY for potential red flags supported by data; keep tone calm and non‑diagnostic.
6. Respect age norms and timezone when recommending schedules; avoid unsafe guidance.

Example response structure:
{
  "insights": [
    {
      "title": "Optimal Feeding Window Found",
      "description": "Baby sleeps 45 minutes longer when fed at 7 PM compared to other times.",
      "type": "feeding",
      "confidence": 0.85,
      "recommendation": "Try consistent 7 PM feeds for better sleep",
      "whyItMatters": "Longer sleep supports brain development and growth",
      "priority": 1
    },
    {
      "title": "Wake Window Optimization",
      "description": "2-hour wake windows lead to 30% longer naps than 1.5-hour windows.",
      "type": "sleep",
      "confidence": 0.75,
      "recommendation": "Extend wake windows gradually to 2 hours",
      "whyItMatters": "Appropriate wake windows prevent overtiredness and improve sleep quality",
      "priority": 2
    }
  ],
  "alerts": [
    {
      "title": "Low Wet Diapers",
      "severity": "medium",
      "note": "Only 3 wet diapers in last 24 hours (recommended: 6+ for age)",
      "priority": 2
    }
  ],
  "miniPlan": {
    "tonightBedtimeTarget": "19:30",
    "nextWakeWindows": ["1h30m", "2h"],
    "feedingNote": "Offer extra 20ml at bedtime feed"
  },
  "measureOfSuccess": "Baby sleeps through 2-hour blocks tonight with fewer night wakings"

}

Rules:
1. Return ONLY valid JSON (no markdown, no extra text).
2. Allowed type for insights: "feeding", "sleep", "diaper", "general".
3. Allowed severity for alerts: "low", "medium", "high".
4. Confidence: 0.0-1.0 based on data strength (0.9 strong pattern, 0.3 weak signal).
5. Priority: 1 (highest) to 5 (lowest) based on importance/urgency.
6. Max 3 insights, max 2 alerts.
7. NO medical diagnosis. If concerning trend, suggest contacting a pediatrician.
8. Recommendations must be specific, time‑bound, and feasible for age.
9. For "measureOfSuccess": describe ONE observable outcome for next 24 hours (not vague).`;

        const userContent = JSON.stringify(contextPayload);

        return { systemPrompt, userContent };
    }

    formatMeasurementCompact(m) {
        if (!m) {return 'no measurements';}
        const parts = [];
        if (m.weight_kg) {parts.push(`${m.weight_kg}kg`);}
        if (m.height_cm) {parts.push(`${m.height_cm}cm`);}
        return parts.join('/') || 'no measurements';
    }

    async callDeepSeekAPI(systemPrompt, userContent) {
        const attempts = Math.max(1, this.retries + 1);
        let lastError = null;

        for (let i = 0; i < attempts; i++) {
            try {
                const response = await axios.post(this.apiBaseUrl, {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: systemPrompt
                        },
                        {
                            role: 'user',
                            content: userContent
                        }
                    ],
                    temperature: this.temperature,
                    max_tokens: this.maxTokens
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000,
                    maxBodyLength: 1_000_000,
                    maxContentLength: 1_000_000
                });

                // Track token usage for cost monitoring
                if (response.data.usage) {
                    this.lastTokenUsage = {
                        promptTokens: response.data.usage.prompt_tokens,
                        completionTokens: response.data.usage.completion_tokens,
                        totalTokens: response.data.usage.total_tokens
                    };
                    console.log(`[DeepSeek] Tokens: prompt=${this.lastTokenUsage.promptTokens}, completion=${this.lastTokenUsage.completionTokens}, total=${this.lastTokenUsage.totalTokens}`);
                }

                return response.data.choices[0].message.content;
            } catch (error) {
                const status = error?.response?.status;
                const errorData = error?.response?.data;
                lastError = error;

                // Auth errors - don't retry
                if (status === 401 || status === 403) {
                    const authError = new Error('DEEPSEEK_AUTH');
                    authError.code = 'DEEPSEEK_AUTH';
                    throw authError;
                }

                // Rate limit - log and use longer backoff
                if (status === 429) {
                    const retryAfter = error?.response?.headers?.['retry-after'] || 60;
                    console.warn(`[DeepSeek] Rate limited. Retry after ${retryAfter}s`);
                    if (i < attempts - 1) {
                        await this.delay(Math.min(retryAfter * 1000, 30000)); // Max 30s wait
                        continue;
                    }
                }

                // Quota exceeded - non-retriable
                if (status === 402 || errorData?.error?.type === 'insufficient_quota') {
                    const quotaError = new Error('DEEPSEEK_QUOTA');
                    quotaError.code = 'DEEPSEEK_QUOTA';
                    console.error('[DeepSeek] Quota exceeded');
                    throw quotaError;
                }

                // Server errors - retriable with backoff
                const retriable = !status || [408, 425, 500, 502, 503, 504].includes(status);
                const isLastAttempt = i === attempts - 1;

                if (!retriable || isLastAttempt) {
                    console.error(`[DeepSeek] API error: status=${status}, message=${error.message}`);
                    throw error;
                }

                // Exponential backoff with jitter: 1s, 2s, 4s... (cap 10s)
                const baseDelayMs = Math.min(1000 * Math.pow(2, i), 10000);
                const delayMs = baseDelayMs + Math.floor(Math.random() * 250);
                console.log(`[DeepSeek] Retry ${i + 1}/${attempts} after ${delayMs}ms`);
                await this.delay(delayMs);
            }
        }

        throw lastError;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    formatMeasurement(measurement) {
        if (!measurement) {return 'none';}
        const parts = [];
        if (measurement.weight_kg) {parts.push(`${measurement.weight_kg} kg`);}
        if (measurement.height_cm) {parts.push(`${measurement.height_cm} cm`);}
        if (measurement.head_circumference_cm) {parts.push(`head ${measurement.head_circumference_cm} cm`);}
        const dateLabel = measurement.measurement_date ? new Date(measurement.measurement_date).toISOString().split('T')[0] : 'unknown date';
        return `${parts.join(', ') || 'no values'} (on ${dateLabel})`;
    }

    parseDeepSeekResponse(response, patterns) {
        try {
            // Strip markdown code blocks if present (```json ... ```)
            let cleanResponse = (response || '').trim();
            if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            // If DeepSeek adds prose, extract the first JSON object.
            const extractedJson = this.extractFirstJsonObject(cleanResponse) || cleanResponse;
            const parsed = JSON.parse(extractedJson);

            return {
                ...parsed,
                patterns,
                dataDays: patterns?.overallStats?.dataDays,
                source: 'deepseek_ai'
            };
        } catch (error) {
            console.log('[DeepSeek] JSON parse failed, using text fallback:', error.message);
            return {
                insights: [{
                    title: 'AI Analysis Complete',
                    description: response,
                    type: 'general',
                    confidence: 0.7,
                    recommendation: 'Review the detailed analysis above',
                    whyItMatters: '',
                    priority: 3
                }],
                alerts: [],
                miniPlan: {
                    tonightBedtimeTarget: '',
                    nextWakeWindows: [],
                    feedingNote: ''
                },
                measureOfSuccess: '',
                summary: 'AI analysis completed successfully',
                patterns,
                dataDays: patterns?.overallStats?.dataDays,
                source: 'deepseek_ai'
            };
        }
    }

    // Extract the first balanced JSON object from a string.
    // Handles cases where the model wraps JSON with extra text.
    extractFirstJsonObject(text) {
        if (!text) {return null;}
        const start = text.indexOf('{');
        if (start === -1) {return null;}
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{') {depth += 1;}
            if (ch === '}') {depth -= 1;}
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
        return null;
    }

    sanitizeAIResponse(aiResponse) {
        if (!aiResponse || typeof aiResponse !== 'object') {
            return aiResponse;
        }

        const sanitized = { ...aiResponse };

        // Normalize missing top-level fields to keep UI stable.
        if (!Array.isArray(sanitized.insights)) {sanitized.insights = [];}
        if (!Array.isArray(sanitized.alerts)) {sanitized.alerts = [];}
        if (!sanitized.miniPlan || typeof sanitized.miniPlan !== 'object') {
            sanitized.miniPlan = { tonightBedtimeTarget: '', nextWakeWindows: [], feedingNote: '' };
        }
        if (sanitized.measureOfSuccess === undefined || sanitized.measureOfSuccess === null) {
            sanitized.measureOfSuccess = '';
        }

        if (Array.isArray(sanitized.insights)) {
            const allowedInsightTypes = new Set(['feeding', 'sleep', 'diaper', 'general']);
            sanitized.insights = sanitized.insights.slice(0, 3).map(insight => {
                const rawType = this.escapeText(insight.type).toLowerCase();
                const type = allowedInsightTypes.has(rawType) ? rawType : 'general';
                const confidence = Math.min(Math.max(Number(insight.confidence) || 0, 0), 1);
                const priorityNum = Number(insight.priority);
                const priority = Number.isFinite(priorityNum) ? Math.min(Math.max(priorityNum, 1), 5) : 3;
                return {
                    title: this.escapeText(insight.title),
                    description: this.escapeText(insight.description),
                    type,
                    confidence,
                    recommendation: this.escapeText(insight.recommendation),
                    whyItMatters: this.escapeText(insight.whyItMatters),
                    priority
                };
            });
        }

        if (Array.isArray(sanitized.alerts)) {
            const allowedSeverities = new Set(['low', 'medium', 'high']);
            sanitized.alerts = sanitized.alerts.slice(0, 2).map(alert => {
                const rawSeverity = this.escapeText(alert.severity).toLowerCase();
                const severity = allowedSeverities.has(rawSeverity) ? rawSeverity : 'low';
                const priorityNum = Number(alert.priority);
                const priority = Number.isFinite(priorityNum) ? Math.min(Math.max(priorityNum, 1), 5) : 3;
                return {
                    title: this.escapeText(alert.title),
                    severity,
                    note: this.escapeText(alert.note),
                    priority
                };
            });
        }

        if (sanitized.miniPlan) {
            sanitized.miniPlan = {
                tonightBedtimeTarget: this.escapeText(sanitized.miniPlan.tonightBedtimeTarget),
                nextWakeWindows: Array.isArray(sanitized.miniPlan.nextWakeWindows) ? sanitized.miniPlan.nextWakeWindows.map(w => this.escapeText(w)) : [],
                feedingNote: this.escapeText(sanitized.miniPlan.feedingNote)
            };
        }

        sanitized.measureOfSuccess = this.escapeText(sanitized.measureOfSuccess);
        return sanitized;
    }

    escapeText(text) {
        if (text === null || text === undefined) {return '';}
        return String(text).replace(/[<>]/g, '').trim();
    }

    // Generate combined insights (statistical + AI)
    async generateEnhancedInsights(context = {}) {
        const statisticalInsights = this.extractStatisticalPatterns();
        // Pass precomputed patterns and full data days for sufficiency check
        const aiInsights = await this.analyzeWithDeepSeek({
            ...context,
            goal: context.goal || this.goal,
            concerns: context.concerns || this.concerns,
            olderSummary: statisticalInsights.olderSummary,
            precomputedPatterns: statisticalInsights,
            fullDataDays: statisticalInsights.fullDataDays
        });

        return {
            statistical: statisticalInsights,
            aiEnhanced: aiInsights,
            timestamp: new Date().toISOString(),
            dataQuality: {
                days: this.getDaysOfData(),
                sufficient: this.hasSufficientData(),
                totalEvents: this.events.length
            },
            tokenUsage: this.lastTokenUsage
        };
    }
}

// Real-time pattern detection for immediate safety alerts (no AI needed)
class PatternDetector {
    constructor(events, timezone, ageWeeks = 8) {
        this.events = events;
        this.timezone = timezone;
        this.ageWeeks = ageWeeks;
    }

    // Get age-appropriate thresholds
    getThresholds() {
        if (this.ageWeeks <= 4) {
            return {
                maxFeedingGapHours: 4,
                minSleepHoursPerDay: 14,
                maxSleepHoursPerDay: 19,
                minDiapersPerDay: 6,
                minFeedsPerDay: 8
            };
        } else if (this.ageWeeks <= 12) {
            return {
                maxFeedingGapHours: 5,
                minSleepHoursPerDay: 14,
                maxSleepHoursPerDay: 17,
                minDiapersPerDay: 5,
                minFeedsPerDay: 6
            };
        }
            return {
                maxFeedingGapHours: 6,
                minSleepHoursPerDay: 12,
                maxSleepHoursPerDay: 16,
                minDiapersPerDay: 4,
                minFeedsPerDay: 5
            };

    }

    // Detect all anomalies - returns array of alerts
    detectAnomalies() {
        const alerts = [];
        const thresholds = this.getThresholds();

        // Check feeding gaps
        const feedingGap = this.detectFeedingGaps(thresholds.maxFeedingGapHours);
        if (feedingGap) {alerts.push(feedingGap);}

        // Check daily sleep
        const sleepAlert = this.detectLowSleep(thresholds.minSleepHoursPerDay);
        if (sleepAlert) {alerts.push(sleepAlert);}

        // Check diaper output
        const diaperAlert = this.detectLowDiapers(thresholds.minDiapersPerDay);
        if (diaperAlert) {alerts.push(diaperAlert);}

        // Check feeding frequency
        const feedingAlert = this.detectLowFeedings(thresholds.minFeedsPerDay);
        if (feedingAlert) {alerts.push(feedingAlert);}

        // Check for long wake windows
        const wakeAlert = this.detectLongWakeWindow();
        if (wakeAlert) {alerts.push(wakeAlert);}

        return alerts;
    }

    // Detect feeding gaps longer than threshold
    detectFeedingGaps(maxHours) {
        const feedEvents = this.events
            .filter(e => e.type === 'milk')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (feedEvents.length < 2) {return null;}

        // Check gap from last feed to now
        const lastFeed = feedEvents[feedEvents.length - 1];
        const lastFeedTime = new Date(lastFeed.timestamp);
        const now = new Date();
        const hoursSinceLastFeed = (now - lastFeedTime) / (1000 * 60 * 60);

        if (hoursSinceLastFeed > maxHours) {
            return {
                type: 'feeding_gap',
                severity: hoursSinceLastFeed > maxHours + 2 ? 'high' : 'medium',
                title: 'Long feeding gap',
                message: `It's been ${hoursSinceLastFeed.toFixed(1)} hours since last feed (threshold: ${maxHours}h)`,
                lastFeedTime: lastFeedTime.toISOString(),
                hoursAgo: Math.round(hoursSinceLastFeed * 10) / 10,
                priority: 1,
                actionable: true
            };
        }

        // Check historical gaps in last 24 hours
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const recentFeeds = feedEvents.filter(e => new Date(e.timestamp) >= oneDayAgo);

        let maxGap = 0;
        let maxGapStart = null;
        for (let i = 1; i < recentFeeds.length; i++) {
            const gap = (new Date(recentFeeds[i].timestamp) - new Date(recentFeeds[i-1].timestamp)) / (1000 * 60 * 60);
            if (gap > maxGap) {
                maxGap = gap;
                maxGapStart = recentFeeds[i-1].timestamp;
            }
        }

        if (maxGap > maxHours) {
            return {
                type: 'feeding_gap_historical',
                severity: 'low',
                title: 'Long feeding gap today',
                message: `${maxGap.toFixed(1)}h gap detected in last 24 hours`,
                gapStartTime: maxGapStart,
                gapHours: Math.round(maxGap * 10) / 10,
                priority: 3,
                actionable: false
            };
        }

        return null;
    }

    // Detect low daily sleep in last complete day
    detectLowSleep(minHours) {
        const dateKey = (ts) => new Intl.DateTimeFormat('en-CA', {
            timeZone: this.timezone,
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date(ts));

        const todayKey = dateKey(Date.now());
        const sleepByDay = {};

        this.events
            .filter(e => e.type === 'sleep' && Number.isFinite(e.amount))
            .forEach(e => {
                const key = dateKey(e.timestamp);
                sleepByDay[key] = (sleepByDay[key] || 0) + e.amount;
            });

        // Check yesterday (most recent complete day)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = dateKey(yesterday);

        const yesterdaySleepMin = sleepByDay[yesterdayKey] || 0;
        const yesterdaySleepHours = yesterdaySleepMin / 60;

        if (yesterdaySleepHours > 0 && yesterdaySleepHours < minHours) {
            return {
                type: 'low_sleep',
                severity: yesterdaySleepHours < minHours - 2 ? 'high' : 'medium',
                title: 'Low sleep yesterday',
                message: `Only ${yesterdaySleepHours.toFixed(1)} hours of sleep yesterday (minimum: ${minHours}h)`,
                date: yesterdayKey,
                sleepHours: Math.round(yesterdaySleepHours * 10) / 10,
                priority: 2,
                actionable: true
            };
        }

        return null;
    }

    // Detect low diaper output in last 24 hours
    detectLowDiapers(minCount) {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentDiapers = this.events.filter(e =>
            e.type === 'diaper' && new Date(e.timestamp) >= oneDayAgo
        );

        const count = recentDiapers.length;
        const wetCount = recentDiapers.filter(e => e.subtype === 'pee' || e.subtype === 'both').length;

        if (count < minCount) {
            return {
                type: 'low_diapers',
                severity: count < minCount - 2 ? 'high' : 'medium',
                title: 'Low diaper output',
                message: `Only ${count} diapers in last 24 hours (minimum: ${minCount})`,
                count,
                wetCount,
                priority: count < 3 ? 1 : 2,
                actionable: true
            };
        }

        // Specifically check wet diapers (hydration indicator)
        if (wetCount < 4) {
            return {
                type: 'low_wet_diapers',
                severity: wetCount < 2 ? 'high' : 'medium',
                title: 'Few wet diapers',
                message: `Only ${wetCount} wet diapers in last 24 hours - monitor hydration`,
                wetCount,
                priority: wetCount < 2 ? 1 : 2,
                actionable: true
            };
        }

        return null;
    }

    // Detect low feeding frequency in last 24 hours
    detectLowFeedings(minCount) {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentFeeds = this.events.filter(e =>
            e.type === 'milk' && new Date(e.timestamp) >= oneDayAgo
        );

        const count = recentFeeds.length;
        const totalMl = recentFeeds.reduce((sum, e) => sum + (e.amount || 0), 0);

        if (count < minCount) {
            return {
                type: 'low_feedings',
                severity: count < minCount - 2 ? 'high' : 'medium',
                title: 'Few feedings today',
                message: `Only ${count} feeds in last 24 hours (minimum: ${minCount})`,
                count,
                totalMl,
                priority: 2,
                actionable: true
            };
        }

        return null;
    }

    // Detect overly long wake windows
    detectLongWakeWindow() {
        // Max wake window by age
        const maxWakeHours = this.ageWeeks <= 4 ? 1.25 :
                            this.ageWeeks <= 8 ? 1.75 :
                            this.ageWeeks <= 12 ? 2.5 :
                            this.ageWeeks <= 16 ? 3 : 4;

        const sleepEvents = this.events
            .filter(e => e.type === 'sleep' && e.sleep_end_time)
            .sort((a, b) => new Date(a.sleep_end_time) - new Date(b.sleep_end_time));

        if (sleepEvents.length === 0) {return null;}

        // Check time since last wake
        const lastSleep = sleepEvents[sleepEvents.length - 1];
        const lastWakeTime = new Date(lastSleep.sleep_end_time);
        const now = new Date();
        const hoursSinceWake = (now - lastWakeTime) / (1000 * 60 * 60);

        if (hoursSinceWake > maxWakeHours) {
            return {
                type: 'long_wake_window',
                severity: hoursSinceWake > maxWakeHours + 1 ? 'medium' : 'low',
                title: 'Long wake window',
                message: `Baby has been awake ${hoursSinceWake.toFixed(1)} hours (max recommended: ${maxWakeHours}h)`,
                hoursSinceWake: Math.round(hoursSinceWake * 10) / 10,
                maxRecommended: maxWakeHours,
                priority: 2,
                actionable: true
            };
        }

        return null;
    }
}

module.exports = { DeepSeekEnhancedAnalyzer, PatternDetector };
