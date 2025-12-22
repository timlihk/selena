const { startOfDay, endOfDay, subDays } = require('date-fns');
const tz = require('date-fns-tz');
const utcToZonedTime = tz.utcToZonedTime || tz.toZonedTime;
const zonedTimeToUtc = tz.zonedTimeToUtc || tz.fromZonedTime;

function getDayBounds(date, timeZone) {
  const zoned = utcToZonedTime(date, timeZone);
  return {
    start: zonedTimeToUtc(startOfDay(zoned), timeZone),
    end: zonedTimeToUtc(endOfDay(zoned), timeZone)
  };
}

function eventOverlapsRange(event, start, end) {
  if (!event) {return false;}

  if (event.type === 'sleep') {
    let sleepStart = event.sleep_start_time ? new Date(event.sleep_start_time) : null;
    if (!sleepStart || Number.isNaN(sleepStart.getTime())) {
      sleepStart = event.timestamp ? new Date(event.timestamp) : null;
    }

    let sleepEnd = event.sleep_end_time ? new Date(event.sleep_end_time) : null;
    if (!sleepEnd || Number.isNaN(sleepEnd.getTime())) {
      sleepEnd = event.timestamp ? new Date(event.timestamp) : new Date();
    }

    if (!sleepStart || Number.isNaN(sleepStart.getTime())) {
      return false;
    }

    if (!sleepEnd || Number.isNaN(sleepEnd.getTime())) {
      sleepEnd = new Date();
    }

    return sleepStart <= end && sleepEnd >= start;
  }

  const eventDate = event.timestamp ? new Date(event.timestamp) : null;
  if (!eventDate || Number.isNaN(eventDate.getTime())) {
    return false;
  }
  return eventDate >= start && eventDate <= end;
}

function getEventsForRange(events, start, end) {
  return events.filter(event => eventOverlapsRange(event, start, end));
}

function getTodayEvents(events, timeZone) {
  const { start, end } = getDayBounds(new Date(), timeZone);
  return getEventsForRange(events, start, end);
}

function calculateFeedingIntelligence(events, timeZone) {
  const todayEvents = getTodayEvents(events, timeZone);
  const milkEvents = todayEvents
    .filter(e => e.type === 'milk')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (milkEvents.length === 0) {
    return null;
  }

  const now = new Date();
  const lastFeed = new Date(milkEvents[milkEvents.length - 1].timestamp);
  const timeSinceLastMs = now - lastFeed;
  const hoursSince = timeSinceLastMs / (1000 * 60 * 60);
  const minutesSince = Math.floor((timeSinceLastMs % (1000 * 60 * 60)) / (1000 * 60));

  const intervals = [];
  for (let i = 1; i < milkEvents.length; i += 1) {
    const prev = new Date(milkEvents[i - 1].timestamp);
    const curr = new Date(milkEvents[i].timestamp);
    intervals.push((curr - prev) / (1000 * 60 * 60));
  }

  const avgInterval = intervals.length > 0
    ? intervals.reduce((sum, val) => sum + val, 0) / intervals.length
    : 3;

  const nextFeedDue = new Date(lastFeed.getTime() + avgInterval * 60 * 60 * 1000);
  const timeUntilNextMs = nextFeedDue - now;
  const minutesUntilNext = Math.floor(timeUntilNextMs / (1000 * 60));

  return {
    lastFeedTime: lastFeed.toISOString(),
    hoursSince: Math.floor(hoursSince),
    minutesSince,
    intervals: intervals.map(h => h.toFixed(1)),
    avgInterval: avgInterval.toFixed(1),
    nextFeedDue: nextFeedDue.toISOString(),
    minutesUntilNext,
    isOverdue: minutesUntilNext < 0
  };
}

function getLastNDaysSleepBreakdown(events, timeZone, days = 3) {
  const breakdown = [];

  for (let i = 0; i < days; i += 1) {
    const date = subDays(new Date(), i);
    const { start, end } = getDayBounds(date, timeZone);

    const daySleepEvents = events.filter(event => event.type === 'sleep')
      .filter(event => eventOverlapsRange(event, start, end));

    const totalMinutes = daySleepEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalHours = totalMinutes / 60;

    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${date.getMonth() + 1}/${date.getDate()}`;

    breakdown.push({
      label,
      hours: totalHours,
      sessionCount: daySleepEvents.length,
      date: date.toISOString().slice(0, 10)
    });
  }

  return breakdown;
}

function calculateSleepQuality(events, timeZone) {
  const todayEvents = getTodayEvents(events, timeZone);
  const sleepEvents = todayEvents
    .filter(e => e.type === 'sleep')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (sleepEvents.length === 0) {
    return null;
  }

  const totalSleepMinutes = sleepEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalSleepHours = totalSleepMinutes / 60;

  const last3DaysBreakdown = getLastNDaysSleepBreakdown(events, timeZone, 3);
  const last3DaysTotalHours = last3DaysBreakdown.reduce((sum, day) => sum + day.hours, 0);
  const last3DaysSessionCount = last3DaysBreakdown.reduce((sum, day) => sum + day.sessionCount, 0);

  const longestSleep = Math.max(...sleepEvents.map(e => e.amount || 0));
  const avgNapMinutes = totalSleepMinutes / sleepEvents.length;

  const wakeWindows = [];
  for (let i = 1; i < sleepEvents.length; i += 1) {
    const prev = sleepEvents[i - 1];
    const curr = sleepEvents[i];

    if (!prev.sleep_end_time || !curr.sleep_start_time) {
      continue;
    }

    const prevEnd = new Date(prev.sleep_end_time);
    const currStart = new Date(curr.sleep_start_time);

    if (Number.isNaN(prevEnd.getTime()) || Number.isNaN(currStart.getTime())) {
      continue;
    }

    const gapHours = (currStart - prevEnd) / (1000 * 60 * 60);
    if (gapHours > 0) {
      wakeWindows.push(gapHours);
    }
  }

  const longestWake = wakeWindows.length > 0 ? Math.max(...wakeWindows) : 0;
  const recommendedHours = 15.5;
  const sleepPercentage = (totalSleepHours / recommendedHours) * 100;

  return {
    totalHours: totalSleepHours.toFixed(1),
    totalMinutes: totalSleepMinutes,
    sessionCount: sleepEvents.length,
    longestStretchMinutes: longestSleep,
    longestStretchHours: (longestSleep / 60).toFixed(1),
    avgNapMinutes: Math.round(avgNapMinutes),
    avgNapHours: (avgNapMinutes / 60).toFixed(1),
    wakeWindows: wakeWindows.map(h => h.toFixed(1)),
    longestWakeHours: longestWake.toFixed(1),
    recommendedHours,
    sleepPercentage: Math.round(sleepPercentage),
    isUnderslept: sleepPercentage < 85,
    last3DaysTotalHours: last3DaysTotalHours.toFixed(1),
    last3DaysSessionCount,
    last3DaysBreakdown
  };
}

function calculateDiaperHealth(events, timeZone) {
  const todayEvents = getTodayEvents(events, timeZone);
  const diaperEvents = todayEvents
    .filter(e => e.type === 'diaper' || e.type === 'poo')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (diaperEvents.length === 0) {
    return null;
  }

  const now = new Date();
  let peeCount = 0;
  let pooCount = 0;
  let bothCount = 0;
  let lastPeeTime = null;
  let lastPooTime = null;
  let lastChangeTime = null;
  const peeTimestamps = [];

  for (const event of diaperEvents) {
    const eventTime = new Date(event.timestamp);
    lastChangeTime = eventTime;

    if (event.type === 'poo') {
      pooCount += 1;
      lastPooTime = eventTime;
    } else if (event.subtype === 'pee') {
      peeCount += 1;
      lastPeeTime = eventTime;
      peeTimestamps.push(eventTime);
    } else if (event.subtype === 'poo') {
      pooCount += 1;
      lastPooTime = eventTime;
    } else if (event.subtype === 'both') {
      bothCount += 1;
      peeCount += 1;
      pooCount += 1;
      lastPeeTime = eventTime;
      lastPooTime = eventTime;
      peeTimestamps.push(eventTime);
    }
  }

  const calcTimeSince = (lastTime) => {
    if (!lastTime) {return { hours: null, minutes: null };}
    const ms = now - lastTime;
    return {
      hours: Math.floor(ms / (1000 * 60 * 60)),
      minutes: Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    };
  };

  const sinceLast = calcTimeSince(lastChangeTime);
  const sincePee = calcTimeSince(lastPeeTime);
  const sincePoo = calcTimeSince(lastPooTime);

  let avgPeeInterval = null;
  if (peeTimestamps.length > 1) {
    let totalInterval = 0;
    for (let i = 1; i < peeTimestamps.length; i += 1) {
      totalInterval += (peeTimestamps[i] - peeTimestamps[i - 1]) / (1000 * 60 * 60);
    }
    avgPeeInterval = (totalInterval / (peeTimestamps.length - 1)).toFixed(1);
  }

  return {
    totalChanges: diaperEvents.length,
    peeCount,
    pooCount,
    bothCount,
    lastChangeTime: lastChangeTime ? lastChangeTime.toISOString() : null,
    hoursSinceLast: sinceLast.hours,
    minutesSinceLast: sinceLast.minutes,
    lastPeeTime: lastPeeTime ? lastPeeTime.toISOString() : null,
    hoursSincePee: sincePee.hours,
    minutesSincePee: sincePee.minutes,
    lastPooTime: lastPooTime ? lastPooTime.toISOString() : null,
    hoursSincePoo: sincePoo.hours,
    minutesSincePoo: sincePoo.minutes,
    avgPeeInterval,
    noPeeAlert: sincePee.hours >= 4,
    noPooAlert: sincePoo.hours >= 24,
    noChangeAlert: sinceLast.hours >= 3
  };
}

function calculateSmartAlerts(feedingIntel, diaperHealth, sleepQuality) {
  const alerts = [];
  const now = new Date();

  if (feedingIntel && feedingIntel.isOverdue && feedingIntel.minutesUntilNext < -15) {
    alerts.push({
      type: 'feeding',
      severity: 'warning',
      icon: '🍼',
      message: `Feeding overdue by ${Math.abs(feedingIntel.minutesUntilNext)} minutes`
    });
  }

  if (diaperHealth) {
    if (diaperHealth.noPeeAlert) {
      alerts.push({
        type: 'diaper',
        severity: 'alert',
        icon: '💧',
        message: `No wet diaper in ${diaperHealth.hoursSincePee}h ${diaperHealth.minutesSincePee}m - check hydration`
      });
    }
    if (diaperHealth.noChangeAlert) {
      alerts.push({
        type: 'diaper',
        severity: 'warning',
        icon: '💩',
        message: `No diaper change in ${diaperHealth.hoursSinceLast}h ${diaperHealth.minutesSinceLast}m`
      });
    }
    if (diaperHealth.noPooAlert) {
      alerts.push({
        type: 'diaper',
        severity: 'info',
        icon: '💩',
        message: `No poo in ${diaperHealth.hoursSincePoo}h - monitor for constipation`
      });
    }
  }

  if (sleepQuality) {
    const currentHour = now.getHours();
    if (currentHour >= 20 && sleepQuality.sleepPercentage < 75) {
      const deficit = sleepQuality.recommendedHours - parseFloat(sleepQuality.totalHours);
      alerts.push({
        type: 'sleep',
        severity: 'alert',
        icon: '😴',
        message: `Only ${sleepQuality.totalHours}h sleep today - ${deficit.toFixed(1)}h below recommended`
      });
    }
    if (parseFloat(sleepQuality.longestWakeHours) > 4) {
      alerts.push({
        type: 'sleep',
        severity: 'warning',
        icon: '😴',
        message: `Wake window of ${sleepQuality.longestWakeHours}h exceeds 4h - baby may be overtired`
      });
    }
  }

  return alerts;
}

function buildAnalytics(events, timeZone) {
  const feedingIntelligence = calculateFeedingIntelligence(events, timeZone);
  const sleepQuality = calculateSleepQuality(events, timeZone);
  const diaperHealth = calculateDiaperHealth(events, timeZone);
  const smartAlerts = calculateSmartAlerts(feedingIntelligence, diaperHealth, sleepQuality);

  return {
    feedingIntelligence,
    sleepQuality,
    diaperHealth,
    smartAlerts
  };
}

module.exports = {
  buildAnalytics,
  getTodayEvents,
  getEventsForRange
};
