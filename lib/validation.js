const config = require('../config');

const {
  ALLOWED_EVENT_TYPES,
  ALLOWED_DIAPER_SUBTYPES,
  ALLOWED_USERS,
  VALIDATION
} = config;

const MEASUREMENT_RANGES = {
  weight: { min: 1.5, max: 20, unit: 'kg' },
  height: { min: 40, max: 100, unit: 'cm' },
  headCircumference: { min: 30, max: 55, unit: 'cm' }
};

function validateEventType(type) {
  if (!ALLOWED_EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type: ${type}. Must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}`);
  }
}

function validateUserName(userName) {
  if (!ALLOWED_USERS.includes(userName)) {
    throw new Error(`Invalid user: ${userName}. Must be one of: ${ALLOWED_USERS.join(', ')}`);
  }
}

function validateDiaperSubtype(subtype) {
  if (subtype && !ALLOWED_DIAPER_SUBTYPES.includes(subtype)) {
    throw new Error(`Invalid diaper subtype: ${subtype}. Must be one of: ${ALLOWED_DIAPER_SUBTYPES.join(', ')}`);
  }
}

function validateTimestamp(timestamp) {
  const maxPastDate = new Date();
  maxPastDate.setDate(maxPastDate.getDate() - VALIDATION.TIMESTAMP_MAX_PAST_DAYS);

  const eventDate = new Date(timestamp);
  if (Number.isNaN(eventDate.getTime())) {
    throw new Error('Invalid timestamp format');
  }
  if (eventDate > new Date()) {
    throw new Error('Event timestamp cannot be in the future');
  }
  if (eventDate < maxPastDate) {
    throw new Error(`Event timestamp cannot be more than ${VALIDATION.TIMESTAMP_MAX_PAST_DAYS} days in the past`);
  }
}

function validateMilkAmount(amount) {
  if (amount <= 0 || amount > VALIDATION.MAX_MILK_AMOUNT) {
    throw new Error(`Milk amount must be between 1 and ${VALIDATION.MAX_MILK_AMOUNT} ml`);
  }
}

function validateSleepDuration(duration) {
  if (duration <= 0 || duration > VALIDATION.MAX_SLEEP_DURATION) {
    throw new Error(`Sleep duration must be between 1 and ${VALIDATION.MAX_SLEEP_DURATION} minutes`);
  }
}

function validateMeasurementValue(value, type, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numValue = parseFloat(value);
  if (Number.isNaN(numValue)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  const range = MEASUREMENT_RANGES[type];
  if (numValue < range.min || numValue > range.max) {
    throw new Error(`${fieldName} must be between ${range.min} and ${range.max} ${range.unit}`);
  }

  return numValue;
}

function validateSleepTimes(sleepStart, sleepEnd) {
  if (!sleepStart || !sleepEnd) {
    throw new Error('Both sleep start and end times are required');
  }

  const start = new Date(sleepStart);
  const end = new Date(sleepEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid sleep time format');
  }

  if (end <= start) {
    throw new Error('Sleep end time must be after sleep start time');
  }

  const maxSleepHours = 12;
  const maxDuration = maxSleepHours * 60 * 60 * 1000;
  if ((end - start) > maxDuration) {
    throw new Error(`Sleep duration cannot exceed ${maxSleepHours} hours`);
  }

  const now = new Date();
  if (start > now || end > now) {
    throw new Error('Sleep times cannot be in the future');
  }
}

function verifySleepDuration(duration) {
  const MIN_SLEEP_DURATION = 10;
  const MAX_UNCONFIRMED_DURATION = 300;

  if (duration < MIN_SLEEP_DURATION) {
    return {
      requiresConfirmation: true,
      message: `Sleep duration is only ${duration} minutes. This is very short for a sleep session. Are you sure this is correct?`,
      duration,
      issue: 'too_short'
    };
  }

  if (duration > MAX_UNCONFIRMED_DURATION) {
    return {
      requiresConfirmation: true,
      message: `Sleep duration is ${Math.round(duration / 60 * 10) / 10} hours. This is quite long for a sleep session. Are you sure this is correct?`,
      duration,
      issue: 'too_long'
    };
  }

  return {
    requiresConfirmation: false,
    message: null,
    duration,
    issue: null
  };
}

module.exports = {
  MEASUREMENT_RANGES,
  validateDiaperSubtype,
  validateEventType,
  validateMeasurementValue,
  validateMilkAmount,
  validateSleepDuration,
  validateSleepTimes,
  validateTimestamp,
  validateUserName,
  verifySleepDuration
};
