#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function scanAllSleepIssues() {
  const client = await pool.connect();
  try {
    console.log('🔍 Scanning entire database for sleep data issues...\n');

    // 1. Find negative duration sleep sessions
    console.log('📊 1. Checking for negative duration sleep sessions...\n');
    const negativeSessions = await client.query(`
      SELECT
        id,
        amount,
        sleep_start_time,
        sleep_end_time,
        timestamp,
        user_name,
        EXTRACT(EPOCH FROM (sleep_end_time - sleep_start_time))/60 as actual_minutes
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
        AND sleep_end_time IS NOT NULL
        AND sleep_end_time <= sleep_start_time
      ORDER BY timestamp DESC
    `);

    console.log(`📊 Found ${negativeSessions.rows.length} negative duration sleep sessions:`);
    negativeSessions.rows.forEach(session => {
      console.log(`   ID ${session.id}: ${session.user_name}`);
      console.log(`      Start: ${session.sleep_start_time}`);
      console.log(`      End:   ${session.sleep_end_time}`);
      console.log(`      Duration: ${session.actual_minutes} minutes (INVALID)`);
    });

    // 2. Find duplicate sleep sessions (same user, same start/end)
    console.log('\n📊 2. Checking for duplicate sleep sessions (same user, same start/end)...\n');
    const duplicateSameUser = await client.query(`
      SELECT
        user_name,
        sleep_start_time,
        sleep_end_time,
        COUNT(*) AS count,
        array_agg(id ORDER BY id) AS ids
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
        AND sleep_end_time IS NOT NULL
      GROUP BY user_name, sleep_start_time, sleep_end_time
      HAVING COUNT(*) > 1
      ORDER BY user_name, sleep_start_time
    `);

    console.log(`📊 Found ${duplicateSameUser.rows.length} duplicate sleep sessions (same user):`);
    duplicateSameUser.rows.forEach(dupe => {
      console.log(`   ${dupe.user_name}: ${dupe.count} sessions with same times`);
      console.log(`      Start: ${dupe.sleep_start_time}`);
      console.log(`      End:   ${dupe.sleep_end_time}`);
      console.log(`      IDs:   ${dupe.ids.join(', ')}`);
    });

    // 3. Find overlapping sleep sessions within same user (exclude exact duplicates and boundary-touching)
    console.log('\n📊 3. Checking for overlapping sleep sessions (same user)...\n');
    const overlappingSameUser = await client.query(`
      WITH sleep_sessions AS (
        SELECT
          id,
          user_name,
          sleep_start_time,
          sleep_end_time,
          LAG(sleep_start_time) OVER (PARTITION BY user_name ORDER BY sleep_start_time, id) as prev_start_time,
          LAG(sleep_end_time) OVER (PARTITION BY user_name ORDER BY sleep_start_time, id) as prev_end_time
        FROM baby_events
        WHERE type = 'sleep'
          AND sleep_start_time IS NOT NULL
          AND sleep_end_time IS NOT NULL
      )
      SELECT
        id,
        user_name,
        sleep_start_time,
        sleep_end_time,
        prev_start_time,
        prev_end_time
      FROM sleep_sessions
      WHERE sleep_start_time < prev_end_time
        AND NOT (
          sleep_start_time = prev_start_time
          AND sleep_end_time = prev_end_time
        )
      ORDER BY user_name, sleep_start_time, id
    `);

    console.log(`📊 Found ${overlappingSameUser.rows.length} overlapping sleep sessions (same user):`);
    overlappingSameUser.rows.forEach(session => {
      console.log(`   ID ${session.id}: ${session.user_name}`);
      console.log(`      Start: ${session.sleep_start_time}`);
      console.log(`      End:   ${session.sleep_end_time}`);
      console.log(`      Previous session: ${session.prev_start_time} to ${session.prev_end_time}`);
    });

    // 4. Find overlapping sleep sessions between different users
    console.log('\n📊 4. Checking for overlapping sleep sessions (between users)...\n');
    const overlappingBetweenUsers = await client.query(`
      SELECT
        a.id as id_a,
        a.user_name as user_a,
        a.sleep_start_time as start_a,
        a.sleep_end_time as end_a,
        b.id as id_b,
        b.user_name as user_b,
        b.sleep_start_time as start_b,
        b.sleep_end_time as end_b,
        EXTRACT(EPOCH FROM (
          LEAST(a.sleep_end_time, b.sleep_end_time) -
          GREATEST(a.sleep_start_time, b.sleep_start_time)
        ))/60 as overlap_minutes
      FROM baby_events a
      JOIN baby_events b ON
        a.type = 'sleep' AND b.type = 'sleep'
        AND a.user_name != b.user_name
        AND a.sleep_start_time IS NOT NULL
        AND a.sleep_end_time IS NOT NULL
        AND b.sleep_start_time IS NOT NULL
        AND b.sleep_end_time IS NOT NULL
        AND a.sleep_start_time < b.sleep_end_time
        AND b.sleep_start_time < a.sleep_end_time
        AND a.id < b.id
      ORDER BY overlap_minutes DESC
      LIMIT 20
    `);

    console.log(`📊 Found ${overlappingBetweenUsers.rows.length} overlapping sleep sessions (between users):`);
    overlappingBetweenUsers.rows.forEach(overlap => {
      console.log(`   ${overlap.user_a} (ID ${overlap.id_a}) overlaps with ${overlap.user_b} (ID ${overlap.id_b})`);
      console.log(`      ${overlap.user_a}: ${overlap.start_a} to ${overlap.end_a}`);
      console.log(`      ${overlap.user_b}: ${overlap.start_b} to ${overlap.end_b}`);
      console.log(`      Overlap: ${Math.round(overlap.overlap_minutes)} minutes`);
    });

    // 5. Find days with excessive sleep totals (>24 hours)
    console.log('\n📊 5. Checking for days with excessive sleep totals (>24 hours)...\n');
    const excessiveSleepDays = await client.query(`
      SELECT
        DATE(timestamp AT TIME ZONE 'Asia/Hong_Kong') as date,
        SUM(amount) as total_minutes,
        COUNT(*) as session_count
      FROM baby_events
      WHERE type = 'sleep'
        AND amount IS NOT NULL
        AND amount > 0
      GROUP BY DATE(timestamp AT TIME ZONE 'Asia/Hong_Kong')
      HAVING SUM(amount) > 1440  -- 24 hours in minutes
      ORDER BY total_minutes DESC
    `);

    console.log(`📊 Found ${excessiveSleepDays.rows.length} days with >24 hours of sleep:`);
    excessiveSleepDays.rows.forEach(day => {
      const totalHours = (day.total_minutes / 60).toFixed(1);
      console.log(`   ${day.date}: ${day.total_minutes} minutes (${totalHours} hours) - ${day.session_count} sessions`);
    });

    // 6. Find sleep sessions with unrealistic durations (>12 hours)
    console.log('\n📊 6. Checking for unrealistic sleep durations (>12 hours)...\n');
    const unrealisticDurations = await client.query(`
      SELECT
        id,
        user_name,
        amount,
        sleep_start_time,
        sleep_end_time,
        timestamp
      FROM baby_events
      WHERE type = 'sleep'
        AND amount > 720  -- 12 hours in minutes
      ORDER BY amount DESC
    `);

    console.log(`📊 Found ${unrealisticDurations.rows.length} sleep sessions >12 hours:`);
    unrealisticDurations.rows.forEach(session => {
      const hours = (session.amount / 60).toFixed(1);
      console.log(`   ID ${session.id}: ${session.user_name} - ${session.amount} minutes (${hours} hours)`);
      console.log(`      Start: ${session.sleep_start_time}`);
      console.log(`      End:   ${session.sleep_end_time}`);
    });

    // 7. Find sleep sessions with very short durations (<5 minutes)
    console.log('\n📊 7. Checking for very short sleep durations (<5 minutes)...\n');
    const shortDurations = await client.query(`
      SELECT
        id,
        user_name,
        amount,
        sleep_start_time,
        sleep_end_time,
        timestamp
      FROM baby_events
      WHERE type = 'sleep'
        AND amount < 5
        AND amount > 0
      ORDER BY amount ASC
    `);

    console.log(`📊 Found ${shortDurations.rows.length} sleep sessions <5 minutes:`);
    shortDurations.rows.forEach(session => {
      console.log(`   ID ${session.id}: ${session.user_name} - ${session.amount} minutes`);
      console.log(`      Start: ${session.sleep_start_time}`);
      console.log(`      End:   ${session.sleep_end_time}`);
    });

    // Summary
    console.log('\n📈 SUMMARY OF SLEEP DATA ISSUES:');
    console.log(`   • Negative duration sessions: ${negativeSessions.rows.length}`);
    console.log(`   • Duplicate sessions (same start/end): ${duplicateSameUser.rows.length}`);
    console.log(`   • Overlapping sessions (same user): ${overlappingSameUser.rows.length}`);
    console.log(`   • Overlapping sessions (between users): ${overlappingBetweenUsers.rows.length}`);
    console.log(`   • Days with >24 hours sleep: ${excessiveSleepDays.rows.length}`);
    console.log(`   • Unrealistic durations (>12h): ${unrealisticDurations.rows.length}`);
    console.log(`   • Very short durations (<5m): ${shortDurations.rows.length}`);

    if (negativeSessions.rows.length > 0 ||
        duplicateSameUser.rows.length > 0 ||
        overlappingSameUser.rows.length > 0 ||
        overlappingBetweenUsers.rows.length > 0 ||
        excessiveSleepDays.rows.length > 0 ||
        unrealisticDurations.rows.length > 0) {
      console.log('\n⚠️  ACTION REQUIRED: Found sleep data issues that need fixing');
    } else {
      console.log('\n✅ No major sleep data issues found!');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

scanAllSleepIssues().catch(console.error);
