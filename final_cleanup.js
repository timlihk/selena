#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function finalCleanup() {
  const client = await pool.connect();
  try {
    console.log('🧹 Final cleanup of sleep overlaps...\n');
    console.log('Handling cases where events happen at exact same time as sleep start.\n');
    console.log('Strategy: Delete these sleep records since baby was not sleeping.\n');

    // Start transaction
    await client.query('BEGIN');

    // Find sleeps with events at exact same time as start
    const findSameTimeQuery = `
      SELECT DISTINCT s.id, s.user_name, s.sleep_start_time, s.amount
      FROM baby_events s
      JOIN baby_events e ON
        e.type IN ('diaper', 'poo', 'milk', 'bath')
        AND e.timestamp = s.sleep_start_time
      WHERE s.type = 'sleep'
        AND s.sleep_start_time IS NOT NULL
      ORDER BY s.sleep_start_time DESC
    `;

    console.log('📊 Finding sleeps with events at same time as start...');
    const sameTimeSleeps = await client.query(findSameTimeQuery);

    console.log(`Found ${sameTimeSleeps.rows.length} sleeps with events at same time as start:\n`);

    if (sameTimeSleeps.rows.length === 0) {
      console.log('✅ No same-time sleeps found.');
      await client.query('ROLLBACK');
      return;
    }

    // Show what we'll delete
    sameTimeSleeps.rows.forEach(row => {
      console.log(`Sleep ID ${row.id} (${row.user_name}):`);
      console.log(`  Start time: ${row.sleep_start_time}`);
      console.log(`  Duration: ${row.amount} minutes`);
    });

    // Delete these sleep records
    console.log('\n🗑️  Deleting sleep records...');
    let deletedCount = 0;

    for (const row of sameTimeSleeps.rows) {
      try {
        await client.query('DELETE FROM baby_events WHERE id = $1', [row.id]);
        console.log(`✅ Deleted sleep ${row.id} (${row.user_name})`);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Failed to delete sleep ${row.id}:`, error.message);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n📈 Deletion summary:`);
    console.log(`   • Successfully deleted: ${deletedCount}`);
    console.log(`   • Total found: ${sameTimeSleeps.rows.length}`);

    // Final verification
    if (deletedCount > 0) {
      console.log('\n🔍 Final verification of overlaps...');

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

      console.log(`Remaining overlaps after final cleanup: ${remainingOverlaps}`);

      if (remainingOverlaps === 0) {
        console.log('🎉 ALL OVERLAPS ELIMINATED!');
      } else {
        console.log('⚠️  Some overlaps remain.');

        // Show what remains
        const remainingQuery = `
          SELECT
            s.id, s.user_name, s.sleep_start_time, s.sleep_end_time, s.amount,
            e.type, e.timestamp, e.subtype
          FROM baby_events s
          JOIN baby_events e ON
            s.type = 'sleep'
            AND e.type IN ('diaper', 'poo', 'milk', 'bath')
            AND s.sleep_start_time IS NOT NULL
            AND s.sleep_end_time IS NOT NULL
            AND e.timestamp >= s.sleep_start_time
            AND e.timestamp < s.sleep_end_time
          ORDER BY s.sleep_start_time DESC
          LIMIT 10
        `;

        const remaining = await client.query(remainingQuery);
        console.log('\nRemaining overlaps:');
        remaining.rows.forEach(r => {
          console.log(`  Sleep ${r.id} (${r.user_name}): ${r.sleep_start_time} to ${r.sleep_end_time}`);
          console.log(`    Event: ${r.type} ${r.subtype ? '(' + r.subtype + ')' : ''} at ${r.timestamp}`);
        });
      }
    }

    // Summary statistics
    console.log('\n📊 FINAL SUMMARY:');
    const statsQuery = `
      SELECT
        COUNT(*) as total_sleeps,
        SUM(CASE WHEN sleep_end_time IS NULL THEN 1 ELSE 0 END) as incomplete_sleeps,
        AVG(amount) as avg_duration_min
      FROM baby_events
      WHERE type = 'sleep'
        AND sleep_start_time IS NOT NULL
    `;

    const stats = await client.query(statsQuery);
    const row = stats.rows[0];

    console.log(`Total sleep records: ${row.total_sleeps}`);
    console.log(`Incomplete sleeps: ${row.incomplete_sleeps}`);
    console.log(`Average duration: ${Math.round(row.avg_duration_min)} minutes`);

    console.log('\n✅ Final cleanup complete!');

  } catch (error) {
    console.error('❌ Error during final cleanup:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
if (require.main === module) {
  finalCleanup().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}