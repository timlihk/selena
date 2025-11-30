#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:zojfDoPQwMPlPqzbdvkkDZDTDXQjqRhw@shortline.proxy.rlwy.net:40683/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

async function verifyFixes() {
  const client = await pool.connect();
  try {
    console.log('🔍 Verifying sleep data fixes...\n');

    // Check remaining long sessions
    const longSessions = await client.query('SELECT COUNT(*) as count FROM baby_events WHERE type = \'sleep\' AND amount > 720');
    console.log('📊 Unrealistic durations (>12h):', longSessions.rows[0].count);

    // Check total sleep by date
    const totals = await client.query(`
      SELECT
        DATE(timestamp AT TIME ZONE 'Asia/Hong_Kong') as date,
        SUM(amount) as total_minutes
      FROM baby_events
      WHERE type = 'sleep'
      GROUP BY DATE(timestamp AT TIME ZONE 'Asia/Hong_Kong')
      HAVING SUM(amount) > 1440
      ORDER BY date
    `);

    console.log('\n📊 Days with >24 hours sleep:', totals.rows.length);
    totals.rows.forEach(day => {
      const hours = (day.total_minutes / 60).toFixed(1);
      console.log('   ', `${day.date  }:`, `${hours  } hours`);
    });

    // Check specific problematic sessions
    const problematic = await client.query('SELECT id, user_name, amount FROM baby_events WHERE id IN (187, 138, 251)');
    console.log('\n📊 Fixed long sessions:');
    problematic.rows.forEach(session => {
      const hours = (session.amount / 60).toFixed(1);
      console.log('   ID', `${session.id  }:`, session.user_name, '-', `${session.amount  } minutes (${  hours  } hours)`);
    });

    // Check 11/21/2025 specifically
    const nov21 = await client.query(`
      SELECT SUM(amount) as total_minutes
      FROM baby_events
      WHERE type = 'sleep'
        AND DATE(timestamp AT TIME ZONE 'Asia/Hong_Kong') = '2025-11-21'
    `);

    const nov21Minutes = parseInt(nov21.rows[0].total_minutes) || 0;
    const nov21Hours = Math.round((nov21Minutes / 60) * 10) / 10;
    console.log('\n📊 11/21/2025 total sleep:', `${nov21Minutes  } minutes (${  nov21Hours  } hours)`);

  } finally {
    client.release();
    await pool.end();
  }
}

verifyFixes().catch(console.error);