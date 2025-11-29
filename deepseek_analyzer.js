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
        this.temperature = Number.isFinite(parseFloat(options.temperature)) ? parseFloat(options.temperature) : 0.3;
        this.maxTokens = Number.isFinite(parseInt(options.maxTokens, 10)) ? parseInt(options.maxTokens, 10) : 2000;
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
            const patterns = this.extractStatisticalPatterns();
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
        const ageLabel = context.ageWeeks ? `${context.ageWeeks} weeks` : 'unknown';
        const babyName = context.profile?.name || 'the baby';
        const dob = context.profile?.date_of_birth || 'unknown';
        const tz = context.homeTimezone || this.timezone;
        const measurement = this.formatMeasurement(context.latestMeasurement);
        const goal = context.goal || this.goal || 'balanced sleep and feeds';
        const concerns = context.concerns && context.concerns.length > 0 ? context.concerns.join(', ') : 'none';

        const summary = `
Profile:
- Name: ${babyName}
- Age: ${ageLabel}
- DOB: ${dob}
- Home Timezone: ${tz}
- Latest measurement: ${measurement}

Data Coverage:
- Data period: ${patterns.overallStats.dataDays} days
- Total events: ${patterns.overallStats.totalEvents}
 - Lookback used: ${this.lookbackDays} days
${patterns.olderSummary ? `- Older data summary: ${JSON.stringify(patterns.olderSummary)}` : ''}

Parent Intent:
- Goal: ${goal}
- Concerns: ${concerns}

Feeding:
- Total feeds: ${patterns.feedingPatterns.totalFeeds}
- Average amount: ${Math.round(patterns.feedingPatterns.avgAmount)} ml
- Feeds per day: ${(patterns.feedingPatterns.totalFeeds / patterns.overallStats.dataDays).toFixed(1)}

Sleep:
- Total sleeps: ${patterns.sleepDistribution.totalSleepEvents}
- Average duration: ${Math.round(patterns.sleepDistribution.avgSleepDuration)} min
- Feeding-to-sleep correlations: ${patterns.feedingToSleep.totalCorrelations}
- Average wake window: ${(patterns.wakeWindows.avgWakeWindow * 60).toFixed(0)} min

Diaper:
- Total diapers: ${patterns.diaperPatterns.totalDiapers}
        `;

        return `You are an expert pediatric sleep consultant and baby development specialist.
Ground rules:
- Use current pediatric guidelines for a ${ageLabel} infant.
- Be concise, reassuring, and specific.
- Return ONLY JSON (no markdown, no extra text).

BABY DATA SUMMARY:
${summary}

Respond with strict JSON:
{
  "insights": [
    {
      "title": "string",
      "description": "string",
      "type": "developmental|sleep|feeding|health|general",
      "confidence": 0.0-1.0,
      "recommendation": "actionable next step",
      "whyItMatters": "short rationale"
    }
  ],
  "summary": "overall summary",
  "developmentalStage": "brief stage note",
  "alerts": [
    {
      "title": "potential risk/concern",
      "severity": "low|medium|high",
      "note": "short rationale"
    }
  ],
  "miniPlan": {
    "tonightBedtimeTarget": "HH:MM local",
    "nextWakeWindows": ["XhYm", "XhYm"],
    "feedingNote": "short guidance"
  }
}`;
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
                            content: 'You are a pediatric sleep consultant and baby development expert. Provide accurate, evidence-based advice in a supportive, reassuring tone.'
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
        const aiInsights = await this.analyzeWithDeepSeek({
            ...context,
            goal: context.goal || this.goal,
            concerns: context.concerns || this.concerns,
            olderSummary: statisticalInsights.olderSummary
        });

        return {
            statistical: statisticalInsights,
            aiEnhanced: aiInsights,
            timestamp: new Date().toISOString(),
            dataQuality: {
                days: this.getDaysOfData(),
                sufficient: this.hasSufficientData(),
                totalEvents: this.events.length
            }
        };
    }
}

module.exports = DeepSeekEnhancedAnalyzer;
