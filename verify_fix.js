const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function verify() {
  const client = await pool.connect();
  try {
    console.log('Verifying fix for sleep auto-completion...\n');

    // Find all sleep sessions that have overlapping non-sleep events
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
        CASE
          WHEN s.sleep_end_time IS NULL THEN 'incomplete'
          WHEN e.timestamp < s.sleep_end_time THEN 'ends_later'
          ELSE 'ends_before'
        END as overlap_type
      FROM baby_events s
      JOIN baby_events e ON
        s.type = 'sleep'
        AND e.type IN ('diaper', 'poo', 'milk', 'bath')
        AND s.sleep_start_time IS NOT NULL
        AND e.timestamp >= s.sleep_start_time
        AND (s.sleep_end_time IS NULL OR e.timestamp < s.sleep_end_time)
      ORDER BY s.sleep_start_time DESC, e.timestamp ASC
      LIMIT 20
    `;

    const res = await client.query(query);
    console.log(`Found ${res.rows.length} overlapping sleep/non-sleep pairs:\n`);

    for (const row of res.rows) {
      console.log(`Sleep ID ${row.sleep_id} (${row.sleep_user}):`);
      console.log(`  Start: ${row.sleep_start_time}`);
      console.log(`  End: ${row.sleep_end_time || 'NULL (incomplete)'}`);
      console.log(`  Event: ${row.event_type} ${row.event_subtype ? '(' + row.event_subtype + ')' : ''} at ${row.event_time}`);
      console.log(`  Overlap type: ${row.overlap_type}`);
      console.log(`  Minutes after sleep start: ${Math.round(row.minutes_after_sleep_start)}`);
      console.log('');
    }

    // Check if our new query would catch these
    console.log('\n--- Checking if new auto-completion logic would fix these ---\n');

    for (const row of res.rows) {
      const sleepEnd = row.event_time; // timestamp of the non-sleep event
      // Query for incomplete sleeps at that moment
      const incompleteQuery = `
        SELECT id FROM baby_events
        WHERE type = 'sleep'
          AND sleep_start_time IS NOT NULL
          AND sleep_end_time IS NULL
          AND id = $1
      `;
      const incompleteRes = await client.query(incompleteQuery, [row.sleep_id]);
      // Query for sleeps with end time later than event
      const laterEndQuery = `
        SELECT id FROM baby_events
        WHERE type = 'sleep'
          AND sleep_start_time IS NOT NULL
          AND sleep_end_time IS NOT NULL
          AND sleep_end_time > $1
          AND id = $2
      `;
      const laterEndRes = await client.query(laterEndQuery, [sleepEnd, row.sleep_id]);

      console.log(`Sleep ${row.sleep_id}:`);
      if (incompleteRes.rows.length > 0) {
        console.log(`  ✅ Would be caught by incomplete sleep query`);
      }
      if (laterEndRes.rows.length > 0) {
        console.log(`  ✅ Would be caught by later-end sleep query`);
      }
      if (incompleteRes.rows.length === 0 && laterEndRes.rows.length === 0) {
        console.log(`  ❌ Would NOT be caught by either query (already corrected?)`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(console.error);