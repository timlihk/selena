#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway";
const pool = new Pool({ connectionString: DATABASE_URL });

async function fixAllSleepIssues() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🔧 Fixing all sleep data issues...\n');

    // 1. Fix the three unrealistic long sleep sessions
    console.log('1. Fixing unrealistic long sleep sessions (>12 hours)...\n');

    const longSessions = [
      { id: 187, user: 'Angie', start: '2025-11-20T22:15:00+08:00', end: '2025-11-23T09:14:00+08:00', duration: 3539 },
      { id: 138, user: 'Angie', start: '2025-11-19T08:13:14+08:00', end: '2025-11-20T12:15:00+08:00', duration: 1682 },
      { id: 251, user: 'Charie', start: '2025-11-23T06:22:02+08:00', end: '2025-11-24T09:45:00+08:00', duration: 1643 }
    ];

    for (const session of longSessions) {
      console.log(`   Fixing session ${session.id} (${session.user}): ${session.duration} minutes`);

      // Find the next sleep session after this one starts
      const nextSession = await client.query(`
        SELECT * FROM baby_events
        WHERE type = 'sleep'
          AND user_name != $1
          AND sleep_start_time > $2
          AND sleep_start_time < $3
        ORDER BY sleep_start_time
        LIMIT 1
      `, [session.user, session.start, session.end]);

      let newEndTime;
      let newDuration;

      if (nextSession.rows.length > 0) {
        // End at the next session's start time
        newEndTime = nextSession.rows[0].sleep_start_time;
        const start = new Date(session.start);
        const end = new Date(newEndTime);
        newDuration = Math.round((end - start) / (1000 * 60));
        console.log(`      Setting end time to ${newEndTime} (${newDuration} minutes)`);
      } else {
        // No next session found, set reasonable 12-hour duration
        const start = new Date(session.start);
        const end = new Date(start.getTime() + 12 * 60 * 60000); // 12 hours
        newEndTime = end.toISOString();
        newDuration = 720; // 12 hours
        console.log(`      No next session found, setting 12-hour duration (720 minutes)`);
      }

      // Update the session
      await client.query(`
        UPDATE baby_events
        SET sleep_end_time = $1, amount = $2
        WHERE id = $3
      `, [newEndTime, newDuration, session.id]);

      console.log(`      ✅ Fixed session ${session.id}\n`);
    }

    // 2. Fix overlapping sessions within same user
    console.log('2. Fixing overlapping sessions (same user)...\n');

    const overlappingSameUser = await client.query(`
      WITH sleep_sessions AS (
        SELECT
          id,
          user_name,
          sleep_start_time,
          sleep_end_time,
          LAG(sleep_end_time) OVER (PARTITION BY user_name ORDER BY sleep_start_time) as prev_end_time
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
        prev_end_time
      FROM sleep_sessions
      WHERE sleep_start_time < prev_end_time
      ORDER BY user_name, sleep_start_time
    `);

    console.log(`   Found ${overlappingSameUser.rows.length} overlapping sessions to fix:`);

    for (const session of overlappingSameUser.rows) {
      console.log(`   Fixing session ${session.id} (${session.user_name})`);

      // Move the session to start after the previous one ends
      const newStartTime = session.prev_end_time;
      const oldStart = new Date(session.sleep_start_time);
      const oldEnd = new Date(session.sleep_end_time);
      const duration = Math.round((oldEnd - oldStart) / (1000 * 60));
      const newEndTime = new Date(new Date(newStartTime).getTime() + duration * 60000);

      console.log(`      Old: ${session.sleep_start_time} to ${session.sleep_end_time}`);
      console.log(`      New: ${newStartTime} to ${newEndTime.toISOString()}`);

      await client.query(`
        UPDATE baby_events
        SET sleep_start_time = $1, sleep_end_time = $2
        WHERE id = $3
      `, [newStartTime, newEndTime.toISOString(), session.id]);

      console.log(`      ✅ Fixed\n`);
    }

    // 3. Fix overlapping sessions between users
    console.log('3. Fixing overlapping sessions (between users)...\n');

    // Get all overlapping sessions between users
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
    `);

    console.log(`   Found ${overlappingBetweenUsers.rows.length} overlapping sessions between users`);

    // Strategy: Keep the session that started first, adjust the later one
    for (const overlap of overlappingBetweenUsers.rows) {
      const startA = new Date(overlap.start_a);
      const startB = new Date(overlap.start_b);

      let sessionToFix, newStartTime;

      if (startA < startB) {
        // Session A started first, fix session B
        sessionToFix = { id: overlap.id_b, user: overlap.user_b, oldStart: overlap.start_b, oldEnd: overlap.end_b };
        newStartTime = overlap.end_a;
      } else {
        // Session B started first, fix session A
        sessionToFix = { id: overlap.id_a, user: overlap.user_a, oldStart: overlap.start_a, oldEnd: overlap.end_a };
        newStartTime = overlap.end_b;
      }

      const oldStart = new Date(sessionToFix.oldStart);
      const oldEnd = new Date(sessionToFix.oldEnd);
      const duration = Math.round((oldEnd - oldStart) / (1000 * 60));
      const newEndTime = new Date(new Date(newStartTime).getTime() + duration * 60000);

      console.log(`   Fixing session ${sessionToFix.id} (${sessionToFix.user})`);
      console.log(`      Old: ${sessionToFix.oldStart} to ${sessionToFix.oldEnd}`);
      console.log(`      New: ${newStartTime} to ${newEndTime.toISOString()}`);

      await client.query(`
        UPDATE baby_events
        SET sleep_start_time = $1, sleep_end_time = $2
        WHERE id = $3
      `, [newStartTime, newEndTime.toISOString(), sessionToFix.id]);

      console.log(`      ✅ Fixed\n`);
    }

    await client.query('COMMIT');
    console.log('✅ All sleep data issues fixed!');

    // Verify the fixes
    console.log('\n🔍 Verifying fixes...');

    // Check remaining issues
    const remainingOverlaps = await client.query(`
      SELECT COUNT(*) as count
      FROM (
        WITH sleep_sessions AS (
          SELECT
            id,
            user_name,
            sleep_start_time,
            sleep_end_time,
            LAG(sleep_end_time) OVER (PARTITION BY user_name ORDER BY sleep_start_time) as prev_end_time
          FROM baby_events
          WHERE type = 'sleep'
            AND sleep_start_time IS NOT NULL
            AND sleep_end_time IS NOT NULL
        )
        SELECT * FROM sleep_sessions
        WHERE sleep_start_time < prev_end_time
      ) as overlaps
    `);

    const remainingBetweenOverlaps = await client.query(`
      SELECT COUNT(*) as count
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
    `);

    const remainingLongSessions = await client.query(`
      SELECT COUNT(*) as count
      FROM baby_events
      WHERE type = 'sleep'
        AND amount > 720
    `);

    console.log(`📊 Remaining issues after fixes:`);
    console.log(`   • Overlapping sessions (same user): ${remainingOverlaps.rows[0].count}`);
    console.log(`   • Overlapping sessions (between users): ${remainingBetweenOverlaps.rows[0].count}`);
    console.log(`   • Unrealistic durations (>12h): ${remainingLongSessions.rows[0].count}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to fix sleep issues:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixAllSleepIssues().catch(console.error);