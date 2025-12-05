#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function checkRemainingOverlaps() {
  const client = await pool.connect();
  try {
    console.log('🔍 Checking remaining sleep overlaps...\n');

    // Find all remaining overlaps
    const query = `
      SELECT
        s.id as sleep_id,
        s.user_name as sleep_user,
        s.sleep_start_time,
        s.sleep_end_time,
        s.amount as sleep_duration_min,
        e.id as event_id,
        e.type as event_type,
        e.user_name as event_user,
        e.timestamp as event_time,
        e.subtype as event_subtype,
        EXTRACT(EPOCH FROM (e.timestamp - s.sleep_start_time))/60 as minutes_after_sleep_start,
        EXTRACT(EPOCH FROM (s.sleep_end_time - e.timestamp))/60 as minutes_before_sleep_end,
        CASE
          WHEN s.sleep_end_time IS NULL THEN 'incomplete'
          WHEN e.timestamp = s.sleep_start_time THEN 'same_time_as_start'
          WHEN EXTRACT(EPOCH FROM (e.timestamp - s.sleep_start_time)) <= 0 THEN 'before_or_at_start'
          WHEN s.amount > 720 THEN 'duration_exceeds_12h'
          ELSE 'other'
        END as overlap_reason
      FROM baby_events s
      JOIN baby_events e ON
        s.type = 'sleep'
        AND e.type IN ('diaper', 'poo', 'milk', 'bath')
        AND s.sleep_start_time IS NOT NULL
        AND s.sleep_end_time IS NOT NULL
        AND e.timestamp >= s.sleep_start_time
        AND e.timestamp < s.sleep_end_time
      ORDER BY s.sleep_start_time DESC, e.timestamp ASC
    `;

    const result = await client.query(query);

    console.log(`Found ${result.rows.length} remaining overlaps:\n`);

    // Group by reason
    const byReason = {};
    result.rows.forEach(row => {
      const reason = row.overlap_reason;
      if (!byReason[reason]) byReason[reason] = [];
      byReason[reason].push(row);
    });

    Object.entries(byReason).forEach(([reason, rows]) => {
      console.log(`\n${reason.toUpperCase()}: ${rows.length} overlaps`);
      rows.slice(0, 3).forEach(row => {
        console.log(`  Sleep ${row.sleep_id} (${row.sleep_user}):`);
        console.log(`    Start: ${row.sleep_start_time}`);
        console.log(`    End: ${row.sleep_end_time}`);
        console.log(`    Event: ${row.event_type} at ${row.event_time}`);
        console.log(`    Time after start: ${Math.round(row.minutes_after_sleep_start)} min`);
        if (row.minutes_after_sleep_start <= 0) {
          console.log(`    ⚠️  Event happens at or before sleep start!`);
        }
      });
      if (rows.length > 3) {
        console.log(`  ... and ${rows.length - 3} more`);
      }
    });

    // Show summary
    console.log('\n📊 Summary of remaining issues:');
    console.log(`Total remaining overlaps: ${result.rows.length}`);
    console.log('\nPossible actions:');

    if (byReason['same_time_as_start'] || byReason['before_or_at_start']) {
      console.log('• Events at/before sleep start: Consider adjusting timestamps');
    }
    if (byReason['duration_exceeds_12h']) {
      console.log('• Sleeps > 12h: Manual review needed (likely data error)');
    }
    if (byReason['incomplete']) {
      console.log('• Incomplete sleeps: Should have been fixed, need investigation');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

checkRemainingOverlaps().catch(console.error);