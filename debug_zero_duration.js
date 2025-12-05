#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function debugZeroDuration() {
  const client = await pool.connect();
  try {
    console.log('🔍 Debugging zero duration cases...\n');

    // Find sleeps where overlapping event happens at same time as start or before
    const query = `
      SELECT
        s.id,
        s.user_name,
        s.sleep_start_time,
        s.sleep_end_time,
        s.amount,
        e.id as event_id,
        e.type as event_type,
        e.timestamp as event_time,
        e.subtype as event_subtype,
        EXTRACT(EPOCH FROM (e.timestamp - s.sleep_start_time)) as seconds_diff
      FROM baby_events s
      JOIN baby_events e ON
        e.type IN ('diaper', 'poo', 'milk', 'bath')
        AND e.timestamp >= s.sleep_start_time
        AND e.timestamp < COALESCE(s.sleep_end_time, 'infinity'::timestamp)
      WHERE s.type = 'sleep'
        AND s.sleep_start_time IS NOT NULL
        AND EXTRACT(EPOCH FROM (e.timestamp - s.sleep_start_time)) <= 60  -- within 60 seconds
      ORDER BY s.sleep_start_time DESC, e.timestamp ASC
    `;

    const result = await client.query(query);

    console.log(`Found ${result.rows.length} sleeps with events within 60 seconds of start:\n`);

    for (const row of result.rows) {
      console.log(`Sleep ID ${row.id} (${row.user_name}):`);
      console.log(`  Start: ${row.sleep_start_time}`);
      console.log(`  Event: ${row.event_type} ${row.event_subtype ? '(' + row.event_subtype + ')' : ''} at ${row.event_time}`);
      console.log(`  Time difference: ${row.seconds_diff} seconds`);
      console.log('');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

debugZeroDuration().catch(console.error);