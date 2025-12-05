// Pattern Analyzer for Adaptive Parenting Coach
class PatternAnalyzer {
    constructor(events, timezone) {
        this.events = events;
        this.timezone = timezone;
        this.minDataDays = 14;
    }

    hasSufficientData() {
        const days = this.getDaysOfData();
        return days >= this.minDataDays;
    }

    getDaysOfData() {
        if (this.events.length === 0) {return 0;}
        const timestamps = this.events.map(e => new Date(e.timestamp).getTime());
        const oldest = Math.min(...timestamps);
        const newest = Math.max(...timestamps);
        // Add 1 to count both first and last day (inclusive range)
        return Math.floor((newest - oldest) / (1000 * 60 * 60 * 24)) + 1;
    }

    analyzeFeedingToSleep() {
        const MIN_GLOBAL_CORRELATIONS = 15;
        const MIN_SAMPLES_PER_HOUR = 5;
        const MIN_SLEEP_DURATION_MINUTES = 10;
        const MIN_IMPROVEMENT_MINUTES = 15;
        const MIN_Z_SCORE = 0.5;
        const insights = [];
        const rawSleepEvents = this.events.filter(e => e.type === 'sleep');
        const milkEvents = this.events.filter(e => e.type === 'milk');

        if (rawSleepEvents.length < MIN_GLOBAL_CORRELATIONS || milkEvents.length < MIN_GLOBAL_CORRELATIONS) {
            return insights;
        }

        const sleepEvents = rawSleepEvents.filter(event =>
            Number.isFinite(event.amount) &&
            event.amount >= MIN_SLEEP_DURATION_MINUTES &&
            event.sleep_start_time &&
            event.sleep_end_time
        );

        const correlations = [];
        for (const milk of milkEvents) {
            const milkTime = new Date(milk.timestamp);
            const followingSleep = sleepEvents.find(sleep => {
                const sleepTime = new Date(sleep.timestamp);
                const hoursDiff = (sleepTime - milkTime) / (1000 * 60 * 60);
                return hoursDiff > 0 && hoursDiff <= 4;
            });

            if (followingSleep) {
                const hoursDiff = (new Date(followingSleep.timestamp) - milkTime) / (1000 * 60 * 60);
                correlations.push({
                    hoursFromFeedToSleep: hoursDiff,
                    sleepDuration: followingSleep.amount,
                    feedTime: milkTime.getHours()
                });
            }
        }

        if (correlations.length < MIN_GLOBAL_CORRELATIONS) {
            return insights;
        }

        const byHour = {};
        correlations.forEach(c => {
            const hour = c.feedTime;
            if (!byHour[hour]) {byHour[hour] = [];}
            byHour[hour].push(c.sleepDuration);
        });

        let bestHour = null;
        let bestAvgSleep = 0;
        Object.entries(byHour).forEach(([hour, sleeps]) => {
            if (sleeps.length >= MIN_SAMPLES_PER_HOUR) {
                const avgSleep = sleeps.reduce((sum, s) => sum + s, 0) / sleeps.length;
                if (avgSleep > bestAvgSleep) {
                    bestAvgSleep = avgSleep;
                    bestHour = parseInt(hour, 10);
                }
            }
        });

        const allSleeps = correlations.map(c => c.sleepDuration);
        const avgAllSleep = allSleeps.reduce((sum, s) => sum + s, 0) / allSleeps.length;
        const variance = allSleeps.reduce((sum, duration) => sum + Math.pow(duration - avgAllSleep, 2), 0) / allSleeps.length;
        const stdDeviation = Math.sqrt(variance);

        if (bestHour !== null && bestAvgSleep > 60) {
            const bestDurations = byHour[bestHour];
            const improvement = bestAvgSleep - avgAllSleep;
            const zScore = stdDeviation > 0 ? improvement / stdDeviation : 0;

            if (improvement > MIN_IMPROVEMENT_MINUTES && zScore >= MIN_Z_SCORE) {
                // Blend z-score and sample count for confidence
                // zFactor: caps at 1.0 when z-score reaches 3.0
                // sampleFactor: caps at 1.0 when samples reach 10
                const zFactor = Math.min(zScore / 3, 1);
                const sampleFactor = Math.min(bestDurations.length / 10, 1);
                const confidence = Math.min(zFactor * sampleFactor, 0.9);

                insights.push({
                    type: 'feeding_to_sleep',
                    title: 'Optimal Feeding Window Found',
                    description: `Based on ${correlations.length} feeding sessions, feeding around ${bestHour}:00 leads to ~${Math.round(improvement)} minutes more sleep than average.`,
                    recommendation: `Try feeding around ${bestHour}:00 for better sleep sessions.`,
                    confidence,
                    dataPoints: bestDurations.length,
                    stats: {
                        hour: bestHour,
                        sampleCount: bestDurations.length,
                        averageSleepMinutes: Math.round(bestAvgSleep),
                        overallAverageMinutes: Math.round(avgAllSleep),
                        improvementMinutes: Math.round(improvement),
                        zScore: Number(zScore.toFixed(2)),
                        stdDeviationMinutes: Math.round(stdDeviation || 0)
                    }
                });
            }
        }

        if (insights.length === 0) {
            insights.push({
                type: 'feeding_to_sleep_no_signal',
                title: 'No strong feeding window yet',
                description: `We analyzed ${correlations.length} feeding sessions but no hour stands out yet. Keep logging to help the coach learn.`,
                recommendation: '',
                confidence: 0,
                dataPoints: correlations.length
            });
        }

        return insights;
    }

    analyzeWakeWindows() {
        const MIN_DATA_POINTS = 15;
        const MIN_SAMPLES_PER_WINDOW = 5;
        const MIN_SLEEP_DURATION_MINUTES = 10;
        const MIN_IMPROVEMENT_MINUTES = 10;
        const MIN_Z_SCORE = 0.5;
        const WINDOW_SIZE_HOURS = 0.5;

        const insights = [];
        const rawSleepEvents = this.events.filter(e => e.type === 'sleep')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (rawSleepEvents.length < MIN_DATA_POINTS) {return insights;}

        // Filter for valid sleep events with complete data
        const sleepEvents = rawSleepEvents.filter(event =>
            Number.isFinite(event.amount) &&
            event.amount >= MIN_SLEEP_DURATION_MINUTES &&
            event.sleep_start_time &&
            event.sleep_end_time
        );

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

        if (wakeData.length < MIN_DATA_POINTS) {return insights;}

        // Group by 30-minute windows
        const byWindow = {};
        wakeData.forEach(w => {
            const windowKey = Math.floor(w.wakeWindow / WINDOW_SIZE_HOURS) * WINDOW_SIZE_HOURS;
            if (!byWindow[windowKey]) {byWindow[windowKey] = [];}
            byWindow[windowKey].push(w.followingSleepDuration);
        });

        let bestWindow = null;
        let bestAvgSleep = 0;
        let bestWindowData = [];
        Object.entries(byWindow).forEach(([window, sleeps]) => {
            if (sleeps.length >= MIN_SAMPLES_PER_WINDOW) {
                const avgSleep = sleeps.reduce((sum, s) => sum + s, 0) / sleeps.length;
                if (avgSleep > bestAvgSleep) {
                    bestAvgSleep = avgSleep;
                    bestWindow = parseFloat(window);
                    bestWindowData = sleeps;
                }
            }
        });

        // Calculate overall stats
        const allSleeps = wakeData.map(w => w.followingSleepDuration);
        const avgAllSleep = allSleeps.reduce((sum, s) => sum + s, 0) / allSleeps.length;
        const variance = allSleeps.reduce((sum, d) => sum + Math.pow(d - avgAllSleep, 2), 0) / allSleeps.length;
        const stdDeviation = Math.sqrt(variance);

        if (bestWindow !== null && bestAvgSleep > 60) {
            const improvement = bestAvgSleep - avgAllSleep;
            const zScore = stdDeviation > 0 ? improvement / stdDeviation : 0;

            if (improvement > MIN_IMPROVEMENT_MINUTES && zScore >= MIN_Z_SCORE) {
                // Blend z-score and sample count for confidence
                const zFactor = Math.min(zScore / 3, 1);
                const sampleFactor = Math.min(bestWindowData.length / 10, 1);
                const confidence = Math.min(zFactor * sampleFactor, 0.9);

                const windowMinutes = Math.round((bestWindow + WINDOW_SIZE_HOURS / 2) * 60);
                insights.push({
                    type: 'wake_window',
                    title: 'Ideal Wake Window Found',
                    description: `Based on ${wakeData.length} sleep transitions, ~${windowMinutes}-minute wake windows lead to ${Math.round(improvement)} minutes more sleep than average.`,
                    recommendation: `Try keeping baby awake for ~${windowMinutes} minutes between naps.`,
                    confidence,
                    dataPoints: bestWindowData.length,
                    stats: {
                        windowMinutes,
                        sampleCount: bestWindowData.length,
                        averageSleepMinutes: Math.round(bestAvgSleep),
                        overallAverageMinutes: Math.round(avgAllSleep),
                        improvementMinutes: Math.round(improvement),
                        zScore: Number(zScore.toFixed(2)),
                        stdDeviationMinutes: Math.round(stdDeviation || 0)
                    }
                });
            }
        }

        if (insights.length === 0 && wakeData.length >= MIN_DATA_POINTS) {
            insights.push({
                type: 'wake_window_no_signal',
                title: 'No strong wake window yet',
                description: `We analyzed ${wakeData.length} sleep transitions but no wake window stands out yet. Keep logging to help the coach learn.`,
                recommendation: '',
                confidence: 0,
                dataPoints: wakeData.length
            });
        }

        return insights;
    }

    generateInsights() {
        if (!this.hasSufficientData()) {
            const days = this.getDaysOfData();
            return [{
                type: 'insufficient_data',
                title: 'Keep Logging!',
                description: `The Adaptive Parenting Coach needs at least ${this.minDataDays} days of data to provide personalized insights.`,
                recommendation: `You have ${days} days of data so far. Keep tracking!`,
                confidence: 0,
                dataPoints: days
            }];
        }

        const insights = [];
        insights.push(...this.analyzeFeedingToSleep());
        insights.push(...this.analyzeWakeWindows());

        return insights;
    }
}
