#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function fixZeroDuration() {
  const client = await pool.connect();
  try {
    console.log('🔧 Fixing zero-duration sleep cases...\n');
    console.log('These are sleeps where events happen at the exact same time as sleep start.');
    console.log('Setting duration to 1 minute to resolve overlaps.\n');

    // Start transaction
    await client.query('BEGIN');

    // Find sleeps with events at same time as start
    const findZeroDurationQuery = `
      WITH sleep_events AS (
        SELECT
          s.id,
          s.user_name,
          s.sleep_start_time,
          s.sleep_end_time,
          s.amount,
          MIN(e.timestamp) as earliest_overlapping_event_time,
          EXTRACT(EPOCH FROM (MIN(e.timestamp) - s.sleep_start_time)) as seconds_diff
        FROM baby_events s
        JOIN baby_events e ON
          e.type IN ('diaper', 'poo', 'milk', 'bath')
          AND e.timestamp >= s.sleep_start_time
          AND e.timestamp < COALESCE(s.sleep_end_time, 'infinity'::timestamp)
        WHERE s.type = 'sleep'
          AND s.sleep_start_time IS NOT NULL
        GROUP BY s.id, s.user_name, s.sleep_start_time, s.sleep_end_time, s.amount
        HAVING COUNT(e.id) > 0
      )
      SELECT *
      FROM sleep_events
      WHERE seconds_diff <= 60  -- Within 60 seconds of sleep start
        AND (sleep_end_time IS NULL OR earliest_overlapping_event_time < sleep_end_time)
      ORDER BY sleep_start_time DESC
    `;

    console.log('📊 Finding zero-duration sleep cases...');
    const zeroDurationSleeps = await client.query(findZeroDurationQuery);

    console.log(`Found ${zeroDurationSleeps.rows.length} sleeps with events within 60 seconds of start:\n`);

    const updates = [];

    for (const row of zeroDurationSleeps.rows) {
      const newSleepEnd = new Date(row.sleep_start_time);
      newSleepEnd.setMinutes(newSleepEnd.getMinutes() + 1); // Add 1 minute
      const newDuration = 1;

      updates.push({
        sleepId: row.id,
        userName: row.user_name,
        sleepStart: row.sleep_start_time,
        oldEndTime: row.sleep_end_time,
        newEndTime: newSleepEnd.toISOString(),
        oldDuration: row.amount,
        newDuration,
        secondsDiff: row.seconds_diff,
        overlappingEventTime: row.earliest_overlapping_event_time
      });
    }

    if (updates.length === 0) {
      console.log('✅ No zero-duration cases found.');
      await client.query('ROLLBACK');
      return;
    }

    // Show what we'll fix
    console.log('📋 Zero-duration fixes to apply:');
    updates.forEach(update => {
      console.log(`\nSleep ID ${update.sleepId} (${update.userName}):`);
      console.log(`  Start: ${update.sleepStart}`);
      console.log(`  Event at: ${update.overlappingEventTime} (${update.secondsDiff} seconds after start)`);
      console.log(`  Old end: ${update.oldEndTime || 'NULL'}`);
      console.log(`  New end: ${update.newEndTime} (+1 minute)`);
      console.log(`  Duration: ${update.oldDuration || 'NULL'} → 1 minute`);
    });

    // Apply fixes
    console.log('\n🔄 Applying zero-duration fixes...');
    let successCount = 0;

    for (const update of updates) {
      try {
        await client.query(
          `UPDATE baby_events
           SET amount = $1, sleep_end_time = $2
           WHERE id = $3`,
          [update.newDuration, update.newEndTime, update.sleepId]
        );
        console.log(`✅ Fixed sleep ${update.sleepId}: set to 1 minute duration`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to fix sleep ${update.sleepId}:`, error.message);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n📈 Zero-duration fix summary:`);
    console.log(`   • Successfully fixed: ${successCount}`);
    console.log(`   • Total attempted: ${updates.length}`);

    // Verify no more overlaps
    if (successCount > 0) {
      console.log('\n🔍 Final verification...');

      const verifyQuery = `
        SELECT COUNT(*) as remaining_overlaps
        FROM baby_events s
        JOIN baby_events e ON
          s.type = 'sleep'
          AND e.type IN ('diaper', 'poo', 'milk', 'bath')
          AND s.sleep_start_time IS NOT NULL
          AND s.sleep_end_time IS NOT NULL
          AND e.timestamp >= s.sleep_start_time
          AND e.timestamp < s.sleep_end_time
      `;

      const verifyResult = await client.query(verifyQuery);
      const remainingOverlaps = parseInt(verifyResult.rows[0].remaining_overlaps, 10);

      console.log(`Remaining overlaps after zero-duration fix: ${remainingOverlaps}`);

      if (remainingOverlaps === 0) {
        console.log('✅ All overlaps eliminated!');
      } else {
        console.log('⚠️  Some overlaps remain. May need manual review.');
      }
    }

    console.log('\n🎉 Zero-duration fix process complete!');

  } catch (error) {
    console.error('❌ Error during zero-duration fix:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
if (require.main === module) {
  fixZeroDuration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}