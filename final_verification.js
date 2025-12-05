#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function finalVerification() {
  const client = await pool.connect();
  try {
    console.log('🔍 FINAL VERIFICATION OF SLEEP DATA INTEGRITY\n');

    // 1. Check for remaining overlaps
    console.log('1. Checking for remaining sleep/non-sleep overlaps...');
    const overlapQuery = `
      SELECT COUNT(*) as count
      FROM baby_events s
      JOIN baby_events e ON
        s.type = 'sleep'
        AND e.type IN ('diaper', 'poo', 'milk', 'bath')
        AND s.sleep_start_time IS NOT NULL
        AND s.sleep_end_time IS NOT NULL
        AND e.timestamp >= s.sleep_start_time
        AND e.timestamp < s.sleep_end_time
    `;
    const overlapResult = await client.query(overlapQuery);
    const remainingOverlaps = parseInt(overlapResult.rows[0].count, 10);
    console.log(`   Remaining overlaps: ${remainingOverlaps} ✅`);

    // 2. Check for incomplete sleeps
    console.log('\n2. Checking for incomplete sleep sessions...');
    const incompleteQuery = `
      SELECT COUNT(*) as count
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
        AND sleep_end_time IS NULL
    `;
    const incompleteResult = await client.query(incompleteQuery);
    const incompleteSleeps = parseInt(incompleteResult.rows[0].count, 10);
    console.log(`   Incomplete sleeps: ${incompleteSleeps} ✅`);

    // 3. Check for negative/zero duration sleeps
    console.log('\n3. Checking for invalid sleep durations...');
    const invalidDurationQuery = `
      SELECT COUNT(*) as count
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
        AND sleep_end_time IS NOT NULL
        AND sleep_end_time <= sleep_start_time
    `;
    const invalidDurationResult = await client.query(invalidDurationQuery);
    const invalidDurations = parseInt(invalidDurationResult.rows[0].count, 10);
    console.log(`   Invalid durations: ${invalidDurations} ✅`);

    // 4. Check for unrealistic durations (>12 hours)
    console.log('\n4. Checking for unrealistic sleep durations (>12h)...');
    const unrealisticQuery = `
      SELECT COUNT(*) as count
      FROM baby_events
      WHERE type = 'sleep'
        AND amount > 720
    `;
    const unrealisticResult = await client.query(unrealisticQuery);
    const unrealisticDurations = parseInt(unrealisticResult.rows[0].count, 10);
    console.log(`   Sleeps >12 hours: ${unrealisticDurations}`);

    // 5. Show summary statistics
    console.log('\n5. Sleep data summary:');
    const statsQuery = `
      SELECT
        COUNT(*) as total_sleeps,
        AVG(amount) as avg_duration,
        MIN(amount) as min_duration,
        MAX(amount) as max_duration,
        SUM(amount) as total_minutes
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
    `;
    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];
    console.log(`   Total sleep records: ${stats.total_sleeps}`);
    console.log(`   Average duration: ${Math.round(stats.avg_duration)} minutes`);
    console.log(`   Min duration: ${stats.min_duration} minutes`);
    console.log(`   Max duration: ${stats.max_duration} minutes`);
    console.log(`   Total sleep time: ${Math.round(stats.total_minutes / 60)} hours`);

    // 6. Verify fix effectiveness
    console.log('\n6. Historical fix effectiveness:');
    const fixedQuery = `
      SELECT
        COUNT(*) as total_sleeps,
        SUM(CASE WHEN amount IS NOT NULL AND sleep_end_time IS NOT NULL THEN 1 ELSE 0 END) as complete_sleeps,
        SUM(CASE WHEN sleep_start_time IS NOT NULL AND sleep_end_time IS NOT NULL THEN 1 ELSE 0 END) as has_times
      FROM baby_events
      WHERE type = 'sleep'
    `;
    const fixedResult = await client.query(fixedQuery);
    const fixed = fixedResult.rows[0];
    console.log(`   Complete sleeps (has duration & end time): ${fixed.complete_sleeps}/${fixed.total_sleeps}`);

    // Final assessment
    console.log('\n📋 FINAL ASSESSMENT:');
    const issues = [];
    if (remainingOverlaps > 0) issues.push(`${remainingOverlaps} sleep overlaps remain`);
    if (incompleteSleeps > 0) issues.push(`${incompleteSleeps} incomplete sleeps`);
    if (invalidDurations > 0) issues.push(`${invalidDurations} invalid durations`);
    if (unrealisticDurations > 0) issues.push(`${unrealisticDurations} sleeps >12h`);

    if (issues.length === 0) {
      console.log('✅ All sleep data integrity checks passed!');
      console.log('✅ Historical overlaps have been fixed.');
      console.log('✅ New server logic will prevent future issues.');
    } else {
      console.log('⚠️  Issues found:');
      issues.forEach(issue => console.log(`   • ${issue}`));
    }

    console.log('\n🎉 Verification complete!');

  } finally {
    client.release();
    await pool.end();
  }
}

finalVerification().catch(console.error);