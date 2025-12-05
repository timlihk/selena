#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function applySleepFixes() {
  const client = await pool.connect();
  try {
    console.log('🔧 Applying sleep overlap fixes...\n');
    console.log('This will correct historical sleep sessions that have non-sleep events during them.');
    console.log('Sleep end times will be adjusted to the earliest overlapping event time.\n');

    // Start transaction
    await client.query('BEGIN');

    // Find all sleep sessions that need correction with better validation
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

    console.log(`Found ${overlaps.rows.length} sleep sessions to fix:\n`);

    // Categorize fixes
    const categories = {
      minor: { count: 0, desc: 'Duration reduced by < 30 minutes' },
      moderate: { count: 0, desc: 'Duration reduced by 30-60 minutes' },
      major: { count: 0, desc: 'Duration reduced by > 60 minutes' },
      new: { count: 0, desc: 'Incomplete sleep being completed' }
    };

    const updates = [];

    for (const row of overlaps.rows) {
      const newSleepEnd = row.earliest_overlapping_event_time;
      const newDuration = Math.max(1, Math.round(row.calculated_minutes)); // At least 1 minute

      const reduction = row.issue_type === 'incomplete' ? null :
                       (row.amount - newDuration);

      let category = 'new';
      if (row.issue_type !== 'incomplete') {
        if (reduction < 30) category = 'minor';
        else if (reduction <= 60) category = 'moderate';
        else category = 'major';
      }

      categories[category].count++;

      updates.push({
        sleepId: row.id,
        userName: row.user_name,
        oldEndTime: row.sleep_end_time,
        newEndTime: newSleepEnd,
        oldDuration: row.amount,
        newDuration,
        issueType: row.issue_type,
        reductionMinutes: reduction,
        category,
        overlappingEventTime: row.earliest_overlapping_event_time
      });
    }

    // Print summary
    console.log('📈 Fix summary by category:');
    Object.entries(categories).forEach(([cat, data]) => {
      if (data.count > 0) {
        console.log(`  • ${cat}: ${data.count} sleeps (${data.desc})`);
      }
    });

    if (updates.length === 0) {
      console.log('\n✅ No sleep sessions need fixing.');
      await client.query('ROLLBACK');
      return;
    }

    // Show examples
    console.log('\n📋 Example fixes:');
    const examples = [
      updates.find(u => u.category === 'major'),
      updates.find(u => u.category === 'moderate'),
      updates.find(u => u.category === 'minor'),
      updates.find(u => u.issueType === 'incomplete')
    ].filter(Boolean).slice(0, 3);

    examples.forEach(update => {
      console.log(`\n  Sleep ID ${update.sleepId} (${update.userName}):`);
      console.log(`    Type: ${update.issueType === 'incomplete' ? 'Complete incomplete sleep' : 'Correct end time'}`);
      console.log(`    Start: ${overlaps.rows.find(r => r.id === update.sleepId).sleep_start_time}`);
      console.log(`    Old end: ${update.oldEndTime || 'NULL'}`);
      console.log(`    New end: ${update.newEndTime}`);
      console.log(`    Duration: ${update.oldDuration || 'NULL'} → ${update.newDuration} minutes`);
      if (update.reductionMinutes) {
        console.log(`    Reduction: ${update.reductionMinutes} minutes (${update.category})`);
      }
    });

    // Ask for confirmation
    console.log(`\n⚠️  About to update ${updates.length} sleep sessions.`);
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('Type "YES" to apply fixes, anything else to cancel: ', resolve);
    });
    rl.close();

    if (answer !== 'YES') {
      console.log('\n❌ Cancelled. No changes made.');
      await client.query('ROLLBACK');
      return;
    }

    // Apply the updates
    console.log('\n🔄 Applying fixes...');
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

        console.log(`✅ Fixed sleep ${update.sleepId}: ${update.oldDuration || 'NULL'} → ${update.newDuration} min`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to fix sleep ${update.sleepId}:`, error.message);
        errorCount++;
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n📈 Fix application summary:`);
    console.log(`   • Successfully fixed: ${successCount}`);
    console.log(`   • Failed: ${errorCount}`);
    console.log(`   • Total attempted: ${updates.length}`);

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
        console.log('⚠️  Some overlaps remain. This may be due to:');
        console.log('    • Sleeps with zero/negative duration (skipped)');
        console.log('    • Sleeps > 12 hours duration (skipped)');
        console.log('    • Concurrent updates during fix process');
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
  applySleepFixes().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}