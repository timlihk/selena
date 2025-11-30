#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const HOME_TZ = 'Asia/Hong_Kong';
const pool = new Pool({ connectionString: DATABASE_URL });

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: HOME_TZ,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, type, amount, timestamp
      FROM baby_events
      WHERE type IN ('milk', 'sleep')
      ORDER BY timestamp ASC
    `);

    const events = rows.map(row => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      timestamp: row.timestamp
    }));

    const sleepEvents = events.filter(e => e.type === 'sleep');
    const milkEvents = events.filter(e => e.type === 'milk');

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
          feedId: milk.id,
          feedTimestamp: milkTime,
          feedHour: parseInt(milkTime.toLocaleString('en-US', { timeZone: HOME_TZ, hour: '2-digit', hour12: false }), 10),
          sleepId: followingSleep.id,
          gapHours: hoursDiff,
          sleepDuration: followingSleep.amount || 0
        });
      }
    }

    console.log(`Total correlations: ${correlations.length}`);

    const byHour = {};
    correlations.forEach(c => {
      if (!byHour[c.feedHour]) {
        byHour[c.feedHour] = [];
      }
      byHour[c.feedHour].push(c);
    });

    const perHourStats = Object.entries(byHour)
      .map(([hour, list]) => {
        const durations = list.map(item => item.sleepDuration);
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        return {
          hour: parseInt(hour, 10),
          count: list.length,
          avgDuration: avg,
          minDuration: Math.min(...durations),
          maxDuration: Math.max(...durations)
        };
      })
      .sort((a, b) => b.avgDuration - a.avgDuration);

    const best = perHourStats[0];
    const globalMinEntry = correlations.reduce((min, entry) => (
      entry.sleepDuration < min.sleepDuration ? entry : min
    ), correlations[0]);

    console.log('\nPer-hour breakdown (sorted by avg duration):');
    perHourStats.forEach(stat => {
      console.log(`  ${String(stat.hour).padStart(2, '0')}:00 → avg ${stat.avgDuration.toFixed(1)} min (min ${stat.minDuration} / max ${stat.maxDuration}; ${stat.count} samples)`);
    });

    console.log('\nBest hour summary:');
    console.log(best);

    console.log('\nShortest correlated sleep (likely skewing improvement):');
    console.log({
      feedId: globalMinEntry.feedId,
      feedTime: formatDate(globalMinEntry.feedTimestamp),
      sleepId: globalMinEntry.sleepId,
      duration: globalMinEntry.sleepDuration,
      gapHours: globalMinEntry.gapHours.toFixed(2)
    });

    const improvement = best.avgDuration - globalMinEntry.sleepDuration;
    console.log(`\nImprovement reported by UI approx: ${Math.round(improvement)} minutes`);
  } catch (error) {
    console.error('Failed to analyze feeding correlations:', error);
  } finally {
    await client.release();
    await pool.end();
  }
})();
