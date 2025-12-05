const { Event } = require('./database');

async function debug() {
  const events = await Event.getAll();
  console.log(`Total events: ${events.length}`);
  // Find incomplete sleeps
  const incomplete = events.filter(e => e.type === 'sleep' && e.sleep_start_time && !e.sleep_end_time);
  console.log(`Incomplete sleeps: ${incomplete.length}`);
  incomplete.forEach(e => {
    console.log(`  ID ${e.id}: user ${e.user_name}, start ${e.sleep_start_time}, timestamp ${e.timestamp}`);
  });
  // Find sleeps with end time after today morning
  const today = new Date();
  today.setHours(0,0,0,0);
  const recentSleeps = events.filter(e => e.type === 'sleep' && e.sleep_end_time && new Date(e.sleep_end_time) > today);
  console.log(`Recent completed sleeps (today): ${recentSleeps.length}`);
  recentSleeps.forEach(e => {
    console.log(`  ID ${e.id}: user ${e.user_name}, start ${e.sleep_start_time}, end ${e.sleep_end_time}, duration ${e.amount} min`);
  });
  // Find diaper changes today
  const diapers = events.filter(e => (e.type === 'diaper' || e.type === 'poo') && new Date(e.timestamp) > today);
  console.log(`Diaper events today: ${diapers.length}`);
  diapers.forEach(e => {
    console.log(`  ID ${e.id}: user ${e.user_name}, timestamp ${e.timestamp}, subtype ${e.subtype}`);
  });
  // Check for overlaps with sleep
  for (const d of diapers) {
    const diaperTime = new Date(d.timestamp);
    for (const s of recentSleeps) {
      const sleepStart = new Date(s.sleep_start_time);
      const sleepEnd = new Date(s.sleep_end_time);
      if (diaperTime >= sleepStart && diaperTime <= sleepEnd) {
        console.log(`  💥 Diaper ${d.id} at ${d.timestamp} overlaps sleep ${s.id} (${sleepStart} to ${sleepEnd})`);
      }
    }
  }
}

debug().catch(console.error);