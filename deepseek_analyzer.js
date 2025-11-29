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
        const patterns = {
            feedingToSleep: this.analyzeFeedingToSleep(),
            wakeWindows: this.analyzeWakeWindows(),
            sleepDistribution: this.analyzeSleepDistribution(),
            feedingPatterns: this.analyzeFeedingPatterns(),
            diaperPatterns: this.analyzeDiaperPatterns(),
            overallStats: this.getOverallStats()
        };
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
        // Create a concise summary instead of full JSON
        const summary = `
Baby Age: ${context.ageWeeks || 'unknown'} weeks
Data Period: ${patterns.overallStats.dataDays} days
Timezone: ${this.timezone}

Key Statistics:
- Total Events: ${patterns.overallStats.totalEvents}
- Feeding: ${patterns.feedingPatterns.totalFeeds} feeds (avg ${Math.round(patterns.feedingPatterns.avgAmount)}ml)
- Sleep: ${patterns.sleepDistribution.totalSleepEvents} sleeps (avg ${Math.round(patterns.sleepDistribution.avgSleepDuration)} min)
- Diapers: ${patterns.diaperPatterns.totalDiapers} changes
- Feeding-to-Sleep Correlation: ${patterns.feedingToSleep.totalCorrelations} instances

Sleep Distribution:
- Average sleep duration: ${Math.round(patterns.sleepDistribution.avgSleepDuration)} minutes
- Sleep events per day: ${(patterns.sleepDistribution.totalSleepEvents / patterns.overallStats.dataDays).toFixed(1)}

Feeding Patterns:
- Average amount: ${Math.round(patterns.feedingPatterns.avgAmount)}ml per feed
- Feeds per day: ${(patterns.feedingPatterns.totalFeeds / patterns.overallStats.dataDays).toFixed(1)}

Wake Windows:
- Average wake window: ${(patterns.wakeWindows.avgWakeWindow * 60).toFixed(0)} minutes
- Total transitions analyzed: ${patterns.wakeWindows.totalTransitions}
        `;

        return `You are an expert pediatric sleep consultant and baby development specialist.

BABY DATA SUMMARY:
${summary}

ANALYSIS REQUEST:
Based on this data, please provide:
1. 2-3 key developmental insights
2. Personalized sleep and feeding recommendations
3. Age-appropriate expectations for an ${context.ageWeeks || 'unknown'}-week-old
4. Any patterns that might need attention

Please be concise and focus on actionable advice. Format your response as JSON with this structure:
{
  "insights": [
    {
      "title": "Insight title",
      "description": "Detailed explanation",
      "type": "developmental|sleep|feeding|health",
      "confidence": 0.8,
      "recommendation": "Specific action to take"
    }
  ],
  "summary": "Overall summary",
  "developmentalStage": "Current stage assessment"
}`;
    }

    async callDeepSeekAPI(prompt) {
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
            timeout: 30000
        });

        return response.data.choices[0].message.content;
    }

    parseDeepSeekResponse(response, patterns) {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(response);
            return {
                ...parsed,
                patterns: patterns,
                dataDays: patterns.overallStats.dataDays,
                source: 'deepseek_ai'
            };
        } catch (error) {
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
        const aiInsights = await this.analyzeWithDeepSeek(context);

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
