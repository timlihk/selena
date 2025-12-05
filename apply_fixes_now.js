#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function applyFixesNow() {
  const client = await pool.connect();
  try {
    console.log('🔧 Applying sleep overlap fixes (auto-confirm)...\n');

    // Start transaction
    await client.query('BEGIN');

    // Find all sleep sessions that need correction
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
      ),
      validated AS (
        SELECT
          *,
          CASE
            WHEN sleep_end_time IS NULL THEN 'incomplete'
            WHEN earliest_overlapping_event_time < sleep_end_time THEN 'ends_too_late'
            ELSE 'ok'
          END as issue_type,
          EXTRACT(EPOCH FROM (earliest_overlapping_event_time - sleep_start_time))/60 as calculated_minutes
        FROM sleep_events
        WHERE sleep_end_time IS NULL OR earliest_overlapping_event_time < sleep_end_time
      )
      SELECT *
      FROM validated
      WHERE calculated_minutes > 0  -- Skip zero or negative duration
        AND calculated_minutes <= 720  -- Skip > 12 hours (likely data error)
      ORDER BY sleep_start_time DESC
    `;

    console.log('📊 Finding sleep sessions to fix...');
    const overlaps = await client.query(findOverlapsQuery);

    console.log(`Found ${overlaps.rows.length} sleep sessions to fix.\n`);

    if (overlaps.rows.length === 0) {
      console.log('✅ No sleep sessions need fixing.');
      await client.query('ROLLBACK');
      return;
    }

    // Apply the updates
    console.log('🔄 Applying fixes...');
    let successCount = 0;
    let errorCount = 0;

    for (const row of overlaps.rows) {
      try {
        const newSleepEnd = row.earliest_overlapping_event_time;
        const newDuration = Math.max(1, Math.round(row.calculated_minutes));

        await client.query(
          `UPDATE baby_events
           SET amount = $1, sleep_end_time = $2
           WHERE id = $3`,
          [newDuration, newSleepEnd, row.id]
        );

        const reduction = row.issue_type === 'incomplete' ? null :
                         (row.amount - newDuration);

        console.log(`✅ Fixed sleep ${row.id}: ${row.amount || 'NULL'} → ${newDuration} min` +
                    (reduction ? ` (reduced by ${reduction} min)` : ''));
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to fix sleep ${row.id}:`, error.message);
        errorCount++;
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n📈 Fix application summary:`);
    console.log(`   • Successfully fixed: ${successCount}`);
    console.log(`   • Failed: ${errorCount}`);
    console.log(`   • Total attempted: ${overlaps.rows.length}`);

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
        console.log('⚠️  Some overlaps remain (skipped zero/negative duration or >12h sleeps).');
      }
    }

    console.log('\n🎉 Fix process complete!');

  } catch (error) {
    console.error('❌ Error during fix process:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
if (require.main === module) {
  console.log('⚠️  Auto-confirm mode enabled. Applying fixes without prompting.');
  applyFixesNow().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}