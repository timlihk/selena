#!/usr/bin/env node

const { Command } = require('commander');
const { initializeDatabase, pool } = require('./database');

const program = new Command();

program
  .name('selena-cli')
  .description('CLI for managing and analyzing baby tracker data')
  .version('1.0.0');

async function scanNegativeDurations(client) {
  console.log('📊 Checking for negative duration sleep sessions...');
  const result = await client.query(`
    SELECT id, user_name, amount, sleep_start_time, sleep_end_time
    FROM baby_events
    WHERE type = 'sleep' AND sleep_end_time <= sleep_start_time
    ORDER BY timestamp DESC
  `);
  console.log(`   Found ${result.rows.length} sessions with negative or zero duration.`);
  result.rows.forEach(s => console.log(`      - ID ${s.id} (${s.user_name}): ${s.amount} min`));
  return result.rows;
}

async function scanOverlappingSameUser(client) {
  console.log('📊 Checking for overlapping sleep sessions (same user)...');
  const result = await client.query(`
    SELECT
      a.id as id_a, a.user_name as user_a, a.sleep_start_time as start_a, a.sleep_end_time as end_a, a.amount as amount_a,
      b.id as id_b, b.user_name as user_b, b.sleep_start_time as start_b, b.sleep_end_time as end_b, b.amount as amount_b
    FROM baby_events a
    JOIN baby_events b ON a.user_name = b.user_name AND a.id < b.id
    WHERE a.type = 'sleep' AND b.type = 'sleep'
      AND (a.sleep_start_time, a.sleep_end_time) OVERLAPS (b.sleep_start_time, b.sleep_end_time)
    ORDER BY a.user_name, a.sleep_start_time
  `);
  console.log(`   Found ${result.rows.length} overlapping sessions for the same user.`);
  result.rows.forEach(s => console.log(`      - ID ${s.id_a} and ID ${s.id_b} (${s.user_a}) overlap.`));
  return result.rows;
}

async function scanOverlappingBetweenUsers(client) {
    console.log('📊 Checking for overlapping sleep sessions (between users)...');
    const result = await client.query(`
        SELECT a.id as id_a, a.user_name as user_a, a.sleep_start_time as start_a, a.sleep_end_time as end_a, a.amount as amount_a,
               b.id as id_b, b.user_name as user_b, b.sleep_start_time as start_b, b.sleep_end_time as end_b, b.amount as amount_b
        FROM baby_events a, baby_events b
        WHERE a.type = 'sleep' AND b.type = 'sleep'
          AND a.id < b.id
          AND a.user_name != b.user_name
          AND (a.sleep_start_time, a.sleep_end_time) OVERLAPS (b.sleep_start_time, b.sleep_end_time)
        ORDER BY a.sleep_start_time
    `);
    console.log(`   Found ${result.rows.length} overlapping sessions between different users.`);
    result.rows.forEach(s => console.log(`      - ID ${s.id_a} (${s.user_a}) and ID ${s.id_b} (${s.user_b}) overlap.`));
    return result.rows;
}

async function scanLongSleeps(client) {
  console.log('📊 Checking for unusually long sleep sessions (>12 hours)...');
  const result = await client.query(`
    SELECT id, user_name, amount
    FROM baby_events
    WHERE type = 'sleep' AND amount > 720
    ORDER BY amount DESC
  `);
  console.log(`   Found ${result.rows.length} sessions longer than 12 hours.`);
  result.rows.forEach(s => console.log(`      - ID ${s.id} (${s.user_name}): ${s.amount} min`));
  return result.rows;
}

async function scanShortSleeps(client) {
  console.log('📊 Checking for very short sleep sessions (<5 minutes)...');
  const result = await client.query(`
    SELECT id, user_name, amount
    FROM baby_events
    WHERE type = 'sleep' AND amount > 0 AND amount < 5
    ORDER BY amount ASC
  `);
  console.log(`   Found ${result.rows.length} sessions shorter than 5 minutes.`);
  result.rows.forEach(s => console.log(`      - ID ${s.id} (${s.user_name}): ${s.amount} min`));
  return result.rows;
}


const scanCommand = program.command('scan')
  .description('Scan the database for data integrity issues');

scanCommand
  .command('all')
  .description('Run all scans for sleep data issues')
  .action(async () => {
    await initializeDatabase();
    const client = await pool.connect();
    try {
      console.log('🔍 Running all sleep data scans...\n');
      const negative = await scanNegativeDurations(client);
      const sameUser = await scanOverlappingSameUser(client);
      const betweenUsers = await scanOverlappingBetweenUsers(client);
      const long = await scanLongSleeps(client);
      const short = await scanShortSleeps(client);

      console.log('\n📈 SUMMARY OF SLEEP DATA ISSUES:');
      console.log(`   • Negative duration sessions: ${negative.length}`);
      console.log(`   • Overlapping sessions (same user): ${sameUser.length}`);
      console.log(`   • Overlapping sessions (between users): ${betweenUsers.length}`);
      console.log(`   • Unrealistic durations (>12h): ${long.length}`);
      console.log(`   • Very short durations (<5m): ${short.length}`);
    } finally {
      client.release();
      await pool.end();
    }
  });

scanCommand
  .command('overlap')
  .description('Scan for overlapping sleep sessions')
  .action(async () => {
    await initializeDatabase();
    const client = await pool.connect();
    try {
      console.log('🔍 Scanning for overlapping sleep sessions...\n');
      await scanOverlappingSameUser(client);
      await scanOverlappingBetweenUsers(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

scanCommand
    .command('negative')
    .description('Scan for sleep sessions with negative duration')
    .action(async () => {
        await initializeDatabase();
        const client = await pool.connect();
        try {
            await scanNegativeDurations(client);
        } finally {
            client.release();
            await pool.end();
        }
    });

scanCommand
    .command('short')
    .description('Scan for very short sleep sessions (<5 minutes)')
    .action(async () => {
        await initializeDatabase();
        const client = await pool.connect();
        try {
            await scanShortSleeps(client);
        } finally {
            client.release();
            await pool.end();
        }
    });

scanCommand
    .command('long')
    .description('Scan for very long sleep sessions (>12 hours)')
    .action(async () => {
        await initializeDatabase();
        const client = await pool.connect();
        try {
            await scanLongSleeps(client);
        } finally {
            client.release();
            await pool.end();
        }
    });

const fixCommand = program.command('fix')
    .description('Fix data integrity issues');

fixCommand
    .command('overlap')
    .description('Fix overlapping sleep sessions for the same user')
    .option('--dry-run', 'Show proposed changes without executing them', false)
    .action(async (options) => {
        await initializeDatabase();
        const client = await pool.connect();
        try {
            console.log('🔍 Finding and fixing overlapping sleep sessions...\n');

            // Handle same-user overlaps
            const sameUserOverlaps = await scanOverlappingSameUser(client);
            if (sameUserOverlaps.length > 0) {
                if (options.dryRun) {
                    console.log('\nDRY RUN: Proposed changes for same-user overlaps:');
                } else {
                    console.log('\nApplying fixes for same-user overlaps...');
                    await client.query('BEGIN');
                }

                for (const overlap of sameUserOverlaps) {
                    const a = { id: overlap.id_a, start: new Date(overlap.start_a), end: new Date(overlap.end_a), amount: overlap.amount_a };
                    const b = { id: overlap.id_b, start: new Date(overlap.start_b), end: new Date(overlap.end_b), amount: overlap.amount_b };

                    const earlier = a.start < b.start ? a : b;
                    const later = a.start < b.start ? b : a;

                    const new_start = earlier.end;
                    const new_duration = later.amount; // Keep the original duration
                    const new_end = new Date(new_start.getTime() + new_duration * 60000);

                    if (options.dryRun) {
                        console.log(`   - Fix event ID ${later.id}:`);
                        console.log(`       Old start: ${later.start.toISOString()}`);
                        console.log(`       New start: ${new_start.toISOString()}`);
                        console.log(`       New end:   ${new_end.toISOString()}`);
                    } else {
                        console.log(`   - Fixing event ID ${later.id}...`);
                        await client.query(
                            'UPDATE baby_events SET sleep_start_time = $1, sleep_end_time = $2, amount = $3 WHERE id = $4',
                            [new_start.toISOString(), new_end.toISOString(), new_duration, later.id]
                        );
                    }
                }

                if (!options.dryRun) {
                    await client.query('COMMIT');
                    console.log('\n✅ Same-user overlap fixes applied successfully!');
                }
            } else {
                console.log('✅ No same-user overlaps found to fix.');
            }

            // Check for between-user overlaps and warn
            const betweenUserOverlaps = await scanOverlappingBetweenUsers(client);
            if (betweenUserOverlaps.length > 0) {
                console.log('\n⚠️  Between-user overlaps detected. These require manual review and are not fixed automatically.');
                console.log('   Run "npm run cli scan overlap" for details.');
            }

        } catch (error) {
            if (!options.dryRun) {
                await client.query('ROLLBACK');
            }
            console.error('\n❌ Error fixing overlaps:', error);
        } finally {
            client.release();
            await pool.end();
        }
    });

program.parse(process.argv);
