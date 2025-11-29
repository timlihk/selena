// DeepSeek Enhanced Pattern Analyzer for Advanced Baby Sleep Insights
const axios = require('axios');

class DeepSeekEnhancedAnalyzer {
    constructor(events, timezone, apiKey, options = {}) {
        this.events = events;
        this.timezone = timezone;
        this.apiKey = apiKey;
        this.apiBaseUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.minDataDays = 14;
        this.model = options.model || 'deepseek-chat';
        // Lower temperature (0.1) for consistent, reliable medical advice
        this.temperature = Number.isFinite(parseFloat(options.temperature)) ? parseFloat(options.temperature) : 0.1;
        // Reduced max tokens - optimized prompt needs less response space
        this.maxTokens = Number.isFinite(parseInt(options.maxTokens, 10)) ? parseInt(options.maxTokens, 10) : 1000;
        // Token usage tracking
        this.lastTokenUsage = null;
        this.retries = Number.isFinite(parseInt(options.retries, 10)) ? parseInt(options.retries, 10) : 2;
        this.goal = options.goal || null;
        this.concerns = Array.isArray(options.concerns) ? options.concerns : [];
        this.lookbackDays = Number.isFinite(parseInt(options.lookbackDays, 10)) ? parseInt(options.lookbackDays, 10) : 30;
    }

    hasSufficientData() {
        const days = this.getDaysOfData();
        return days >= this.minDataDays;
    }

    getDaysOfData() {
        if (this.events.length === 0) return 0;
        const timestamps = this.events.map(e => new Date(e.timestamp).getTime());
        const oldest = Math.min(...timestamps);
        const newest = Math.max(...timestamps);
        return Math.floor((newest - oldest) / (1000 * 60 * 60 * 24)) + 1;
    }

    // Extract statistical patterns for AI enhancement
    extractStatisticalPatterns() {
        const { recentEvents, olderEventsSummary } = this.splitEventsByLookback();
        const originalEvents = this.events;
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
            if (!byHour[hour]) byHour[hour] = [];
            byHour[hour].push(event.amount);
        });

        return {
            totalSleepEvents: sleepEvents.length,
            byHour: byHour,
            avgSleepDuration: sleepEvents.reduce((sum, e) => sum + e.amount, 0) / sleepEvents.length || 0
        };
    }

    analyzeFeedingPatterns() {
        const milkEvents = this.events.filter(e => e.type === 'milk');
        const byHour = {};

        milkEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            if (!byHour[hour]) byHour[hour] = [];
            byHour[hour].push(event.amount);
        });

        return {
            totalFeeds: milkEvents.length,
            byHour: byHour,
            avgAmount: milkEvents.reduce((sum, e) => sum + e.amount, 0) / milkEvents.length || 0
        };
    }

    analyzeDiaperPatterns() {
        const diaperEvents = this.events.filter(e => e.type === 'diaper' || e.type === 'poo');
        const byHour = {};
        const byType = { pee: 0, poo: 0, both: 0 };

        diaperEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            if (!byHour[hour]) byHour[hour] = [];
            byHour[hour].push(event.subtype || 'pee');

            const subtype = event.subtype || 'pee';
            byType[subtype] = (byType[subtype] || 0) + 1;
        });

        return {
            totalDiapers: diaperEvents.length,
            byHour: byHour,
            byType: byType
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
            if (!evts || evts.length === 0) return null;
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
        if (!filtered.length) return 0;
        return Math.round(filtered.reduce((sum, e) => sum + e.amount, 0) / filtered.length);
    }

    groupByHour(correlations) {
        const byHour = {};
        correlations.forEach(c => {
            if (!byHour[c.feedTime]) byHour[c.feedTime] = [];
            byHour[c.feedTime].push(c.sleepDuration);
        });
        return byHour;
    }

    groupByWakeWindow(wakeData) {
        const byWindow = {};
        const WINDOW_SIZE_HOURS = 0.5;
        wakeData.forEach(w => {
            const windowKey = Math.floor(w.wakeWindow / WINDOW_SIZE_HOURS) * WINDOW_SIZE_HOURS;
            if (!byWindow[windowKey]) byWindow[windowKey] = [];
            byWindow[windowKey].push(w.followingSleepDuration);
        });
        return byWindow;
    }

    // Sanitize user input to prevent prompt injection
    sanitizePromptInput(input, maxLength = 200) {
        if (!input || typeof input !== 'string') return '';
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
        } else {
            // 6+ months
            return {
                sleepHoursMin: 12, sleepHoursMax: 14,
                wakeWindowMin: 2.5, wakeWindowMax: 3.5,
                feedsPerDayMin: 4, feedsPerDayMax: 6,
                feedAmountMin: 180, feedAmountMax: 240
            };
        }
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
            if (!filtered.length) return null;
            return filtered.reduce((sum, e) => sum + e[field], 0) / filtered.length;
        };

        const formatTrend = (recent, prior, unit) => {
            if (recent === null || prior === null || prior === 0) return null;
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

    // Core DeepSeek API integration
    async analyzeWithDeepSeek(context = {}) {
        const dataDays = this.getDaysOfData();
        console.log(`[DeepSeek] Starting analysis: ${dataDays} days of data, API key: ${this.apiKey ? 'present' : 'MISSING'}, min required: ${this.minDataDays}`);

        if (!this.hasSufficientData()) {
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
                dataDays: dataDays,
                insufficientData: true
            };
        }

        if (!this.apiKey) {
            console.log('[DeepSeek] No API key configured');
            return {
                insights: [],
                error: 'DeepSeek API key not configured. Add DEEPSEEK_API_KEY to environment variables.',
                fallback: true,
                missingApiKey: true
            };
        }

        try {
            // Use precomputed patterns if provided, otherwise compute them
            const patterns = context.precomputedPatterns || this.extractStatisticalPatterns();
            const prompt = this.buildDeepSeekPrompt(patterns, context);

            console.log('[DeepSeek] Calling API...');
            const response = await this.callDeepSeekAPI(prompt);
            console.log('[DeepSeek] API response received, length:', response?.length || 0);
            return this.parseDeepSeekResponse(response, patterns);

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
                insights: [],
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
            .map(c => this.sanitizePromptInput(c, 50)).filter(Boolean).join(', ') || 'none';

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

        // Concise data block - key metrics only
        const data = `Baby: ${ageLabel}, ${measurement}
Goal: ${goal} | Concerns: ${concerns}

Norms(${ageLabel}): sleep ${norms.sleepHoursMin}-${norms.sleepHoursMax}h, wake ${norms.wakeWindowMin}-${norms.wakeWindowMax}h, feeds ${norms.feedsPerDayMin}-${norms.feedsPerDayMax}x @ ${norms.feedAmountMin}-${norms.feedAmountMax}ml

Last ${days}d: feeds ${feedsPerDay}/day @ ${avgFeedMl}ml, sleep avg ${avgSleepMin}min, wake ${avgWakeMin}min, diapers ${diapersPerDay}/day
${trends.feeding ? `Trends: feed ${trends.feeding}, sleep ${trends.sleep || 'stable'}, diaper ${trends.diaper || 'stable'}` : ''}`;

        // Optimized prompt - concise system instruction + data
        return `Pediatric sleep consultant for ${ageLabel} infant. Prioritize: 1)Safety 2)Health 3)Optimization.
Flag: sleep <10h/>18h, no wet diaper 6h+, feed gap >5h. Be specific, actionable, reassuring. JSON only.

${data}

{"insights":[{"title":"","description":"","type":"safety|sleep|feeding|health|general","priority":1-5,"confidence":0-1,"recommendation":"","whyItMatters":""}],"summary":"","alerts":[{"title":"","severity":"low|medium|high","note":""}],"miniPlan":{"bedtime":"HH:MM","wakeWindows":[""],"feedingNote":""}}`;
    }

    formatMeasurementCompact(m) {
        if (!m) return 'no measurements';
        const parts = [];
        if (m.weight_kg) parts.push(`${m.weight_kg}kg`);
        if (m.height_cm) parts.push(`${m.height_cm}cm`);
        return parts.join('/') || 'no measurements';
    }

    async callDeepSeekAPI(prompt) {
        const attempts = Math.max(1, this.retries + 1);
        let lastError = null;

        for (let i = 0; i < attempts; i++) {
            try {
                const response = await axios.post(this.apiBaseUrl, {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'Pediatric sleep consultant. Give accurate, evidence-based, actionable advice. JSON only.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: this.temperature,
                    max_tokens: this.maxTokens
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 45000
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
                if (error?.response?.status === 401 || error?.response?.status === 403) {
                    const authError = new Error('DEEPSEEK_AUTH');
                    authError.code = 'DEEPSEEK_AUTH';
                    throw authError;
                }

                const status = error?.response?.status;
                const retriable = [408, 425, 429, 500, 502, 503, 504].includes(status);
                const isLastAttempt = i === attempts - 1;
                lastError = error;

                if (!retriable || isLastAttempt) {
                    throw error;
                }

                const delayMs = 500 * (i + 1);
                await this.delay(delayMs);
            }
        }

        throw lastError;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    formatMeasurement(measurement) {
        if (!measurement) return 'none';
        const parts = [];
        if (measurement.weight_kg) parts.push(`${measurement.weight_kg} kg`);
        if (measurement.height_cm) parts.push(`${measurement.height_cm} cm`);
        if (measurement.head_circumference_cm) parts.push(`head ${measurement.head_circumference_cm} cm`);
        const dateLabel = measurement.measurement_date ? new Date(measurement.measurement_date).toISOString().split('T')[0] : 'unknown date';
        return `${parts.join(', ') || 'no values'} (on ${dateLabel})`;
    }

    parseDeepSeekResponse(response, patterns) {
        try {
            // Strip markdown code blocks if present (```json ... ```)
            let cleanResponse = response.trim();
            if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            // Try to parse as JSON
            const parsed = JSON.parse(cleanResponse);
            return {
                ...parsed,
                patterns: patterns,
                dataDays: patterns.overallStats.dataDays,
                source: 'deepseek_ai'
            };
        } catch (error) {
            console.log('[DeepSeek] JSON parse failed, using text fallback:', error.message);
            // If JSON parsing fails, return as text analysis
            return {
                insights: [{
                    title: 'AI Analysis Complete',
                    description: response,
                    type: 'general',
                    confidence: 0.7,
                    recommendation: 'Review the detailed analysis above'
                }],
                summary: 'AI analysis completed successfully',
                patterns: patterns,
                dataDays: patterns.overallStats.dataDays,
                source: 'deepseek_ai'
            };
        }
    }

    // Generate combined insights (statistical + AI)
    async generateEnhancedInsights(context = {}) {
        const statisticalInsights = this.extractStatisticalPatterns();
        // Pass precomputed patterns to avoid duplicate computation
        const aiInsights = await this.analyzeWithDeepSeek({
            ...context,
            goal: context.goal || this.goal,
            concerns: context.concerns || this.concerns,
            olderSummary: statisticalInsights.olderSummary,
            precomputedPatterns: statisticalInsights
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

module.exports = DeepSeekEnhancedAnalyzer;
