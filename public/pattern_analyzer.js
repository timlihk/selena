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
        if (this.events.length === 0) return 0;
        const timestamps = this.events.map(e => new Date(e.timestamp).getTime());
        const oldest = Math.min(...timestamps);
        const newest = Math.max(...timestamps);
        // Add 1 to count both first and last day (inclusive range)
        return Math.floor((newest - oldest) / (1000 * 60 * 60 * 24)) + 1;
    }

    analyzeFeedingToSleep() {
        const insights = [];
        const sleepEvents = this.events.filter(e => e.type === 'sleep');
        const milkEvents = this.events.filter(e => e.type === 'milk');

        if (sleepEvents.length < 5 || milkEvents.length < 5) {
            return insights;
        }

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

        if (correlations.length < 3) return insights;

        const byHour = {};
        correlations.forEach(c => {
            const hour = c.feedTime;
            if (!byHour[hour]) byHour[hour] = [];
            byHour[hour].push(c.sleepDuration);
        });

        let bestHour = null;
        let bestAvgSleep = 0;
        for (const [hour, sleeps] of Object.entries(byHour)) {
            if (sleeps.length >= 2) {
                const avgSleep = sleeps.reduce((sum, s) => sum + s, 0) / sleeps.length;
                if (avgSleep > bestAvgSleep) {
                    bestAvgSleep = avgSleep;
                    bestHour = parseInt(hour);
                }
            }
        }

        if (bestHour && bestAvgSleep > 60) {
            const allSleeps = correlations.map(c => c.sleepDuration);
            const minSleep = Math.min(...allSleeps);
            const improvement = bestAvgSleep - minSleep;

            if (improvement > 15) {
                insights.push({
                    type: 'feeding_to_sleep',
                    title: 'Optimal Feeding Window Found',
                    description: `Based on ${correlations.length} feeding sessions, feeding around ${bestHour}:00 leads to ${Math.round(improvement)} minutes longer sleep.`,
                    recommendation: `Try feeding around ${bestHour}:00 for better sleep sessions.`,
                    confidence: Math.min(correlations.length / 10, 0.9),
                    dataPoints: correlations.length
                });
            }
        }

        return insights;
    }

    analyzeWakeWindows() {
        const insights = [];
        const sleepEvents = this.events.filter(e => e.type === 'sleep')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (sleepEvents.length < 5) return insights;

        const wakeData = [];
        for (let i = 1; i < sleepEvents.length; i++) {
            const prevSleep = sleepEvents[i - 1];
            const currSleep = sleepEvents[i];

            if (prevSleep.sleep_end_time) {
                const wakeStart = new Date(prevSleep.sleep_end_time);
                const wakeEnd = new Date(currSleep.timestamp);
                const wakeWindowHours = (wakeEnd - wakeStart) / (1000 * 60 * 60);

                if (wakeWindowHours >= 1 && wakeWindowHours <= 6) {
                    wakeData.push({
                        wakeWindow: wakeWindowHours,
                        followingSleepDuration: currSleep.amount
                    });
                }
            }
        }

        if (wakeData.length < 4) return insights;

        let bestWindow = null;
        let bestSleepDuration = 0;
        const windowSize = 0.5;

        for (let start = 1; start <= 5; start += windowSize) {
            const end = start + windowSize;
            const inRange = wakeData.filter(w => w.wakeWindow >= start && w.wakeWindow < end);

            if (inRange.length >= 3) {
                const avgSleep = inRange.reduce((sum, w) => sum + w.followingSleepDuration, 0) / inRange.length;
                if (avgSleep > bestSleepDuration) {
                    bestSleepDuration = avgSleep;
                    bestWindow = start + windowSize / 2;
                }
            }
        }

        if (bestWindow && bestSleepDuration > 60) {
            const avgAll = wakeData.reduce((sum, w) => sum + w.followingSleepDuration, 0) / wakeData.length;
            const improvement = bestSleepDuration - avgAll;

            if (improvement > 10) {
                insights.push({
                    type: 'wake_window',
                    title: 'Ideal Wake Window Found',
                    description: `${Math.round(bestWindow * 60)}-minute wake windows lead to ${Math.round(improvement)} minutes longer sleep on average.`,
                    recommendation: `Try keeping baby awake for ~${Math.round(bestWindow * 60)} minutes between naps.`,
                    confidence: Math.min(wakeData.length / 8, 0.85),
                    dataPoints: wakeData.length
                });
            }
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
