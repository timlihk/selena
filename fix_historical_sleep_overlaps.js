#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function fixHistoricalOverlaps() {
  const client = await pool.connect();
  try {
    console.log('🔧 Fixing historical sleep overlaps...\n');

    // Start transaction
    await client.query('BEGIN');

    // Find all sleep sessions that need correction
    // For each sleep, find the earliest overlapping non-sleep event
    const findOverlapsQuery = `
      WITH sleep_events AS (
        SELECT
          s.id,
          s.user_name,
          s.sleep_start_time,
          s.sleep_end_time,
          s.amount,
          s.timestamp as sleep_timestamp,
          MIN(e.timestamp) as earliest_overlapping_event_time
        FROM baby_events s
        LEFT JOIN baby_events e ON
          e.type IN ('diaper', 'poo', 'milk', 'bath')
          AND e.timestamp >= s.sleep_start_time
          AND e.timestamp < COALESCE(s.sleep_end_time, 'infinity'::timestamp)
        WHERE s.type = 'sleep'
          AND s.sleep_start_time IS NOT NULL
        GROUP BY s.id, s.user_name, s.sleep_start_time, s.sleep_end_time, s.amount, s.timestamp
        HAVING COUNT(e.id) > 0
      )
      SELECT
        *,
        CASE
          WHEN sleep_end_time IS NULL THEN 'incomplete'
          WHEN earliest_overlapping_event_time < sleep_end_time THEN 'ends_too_late'
          ELSE 'ok'
        END as issue_type
      FROM sleep_events
      WHERE sleep_end_time IS NULL OR earliest_overlapping_event_time < sleep_end_time
      ORDER BY sleep_start_time DESC
    `;

    console.log('📊 Finding sleep sessions with overlapping non-sleep events...');
    const overlaps = await client.query(findOverlapsQuery);

    console.log(`Found ${overlaps.rows.length} sleep sessions that need correction:\n`);

    const updates = [];

    for (const row of overlaps.rows) {
      const newSleepEnd = row.earliest_overlapping_event_time;
      const newDuration = Math.round(
        (new Date(newSleepEnd) - new Date(row.sleep_start_time)) / (1000 * 60)
      );

      // Validate the new duration
      if (newDuration <= 0) {
        console.warn(`⚠️ Skipping sleep ${row.id}: calculated duration ${newDuration} minutes is invalid`);
        continue;
      }

      if (newDuration > 720) { // 12 hours max
        console.warn(`⚠️ Skipping sleep ${row.id}: calculated duration ${newDuration} minutes exceeds 12 hours`);
        continue;
      }

      updates.push({
        sleepId: row.id,
        userName: row.user_name,
        oldEndTime: row.sleep_end_time,
        newEndTime: newSleepEnd,
        oldDuration: row.amount,
        newDuration,
        issueType: row.issue_type,
        overlappingEventTime: row.earliest_overlapping_event_time
      });
    }

    // Log what we're going to update
    console.log('\n📋 Planned updates:');
    updates.forEach(update => {
      console.log(`\nSleep ID ${update.sleepId} (${update.userName}):`);
      console.log(`  Issue type: ${update.issueType}`);
      console.log(`  Start time: ${overlaps.rows.find(r => r.id === update.sleepId).sleep_start_time}`);
      console.log(`  Old end time: ${update.oldEndTime || 'NULL'}`);
      console.log(`  New end time: ${update.newEndTime}`);
      console.log(`  Old duration: ${update.oldDuration || 'NULL'} minutes`);
      console.log(`  New duration: ${update.newDuration} minutes`);
      console.log(`  Earliest overlapping event: ${update.overlappingEventTime}`);
    });

    if (updates.length === 0) {
      console.log('\n✅ No sleep sessions need correction.');
      await client.query('ROLLBACK');
      return;
    }

    // Ask for confirmation
    console.log(`\n⚠️  About to update ${updates.length} sleep sessions.`);
    console.log('Type "YES" to proceed, anything else to cancel:');

    // For safety, we'll require explicit confirmation
    // In a real script, you might use readline or command line args
    // For now, we'll just simulate the updates without applying them
    const shouldApply = process.argv.includes('--apply');

    if (!shouldApply) {
      console.log('\n🔒 Dry run mode (no changes applied).');
      console.log('To apply changes, run with --apply flag.');
      console.log('\nGenerated SQL statements:');

      updates.forEach(update => {
        console.log(`\n-- Sleep ID ${update.sleepId}:`);
        console.log(`UPDATE baby_events`);
        console.log(`SET amount = ${update.newDuration},`);
        console.log(`    sleep_end_time = '${update.newEndTime}'`);
        console.log(`WHERE id = ${update.sleepId};`);
      });

      await client.query('ROLLBACK');
      return;
    }

    // Apply the updates
    console.log('\n🔄 Applying updates...');
    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      try {
        await client.query(
          `UPDATE baby_events
           SET amount = $1, sleep_end_time = $2
           WHERE id = $3`,
          [update.newDuration, update.newEndTime, update.sleepId]
        );

        console.log(`✅ Updated sleep ${update.sleepId}: ${update.oldDuration || 'NULL'} → ${update.newDuration} minutes`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to update sleep ${update.sleepId}:`, error.message);
        errorCount++;
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n📈 Update summary:`);
    console.log(`   • Successfully updated: ${successCount}`);
    console.log(`   • Failed: ${errorCount}`);
    console.log(`   • Total sleep sessions: ${updates.length}`);

    // Verify the fixes
    if (successCount > 0) {
      console.log('\n🔍 Verifying fixes...');

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

      console.log(`Remaining overlaps after fix: ${remainingOverlaps}`);

      if (remainingOverlaps === 0) {
        console.log('✅ All overlaps fixed!');
      } else {
        console.log('⚠️  Some overlaps remain. Manual review may be needed.');
      }
    }

  } catch (error) {
    console.error('❌ Error during fix process:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Check if script should run
if (require.main === module) {
  const shouldApply = process.argv.includes('--apply');
  console.log(`Mode: ${shouldApply ? 'APPLY CHANGES' : 'DRY RUN'}`);

  fixHistoricalOverlaps().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}