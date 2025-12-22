const express = require('express');
const config = require('../config');
const { Event, withTransaction } = require('../database');
const {
  validateEventType,
  validateUserName,
  validateDiaperSubtype,
  validateTimestamp,
  validateMilkAmount,
  validateSleepTimes,
  verifySleepDuration
} = require('../lib/validation');
const apiError = require('../lib/apiError');
const logger = require('../lib/logger');

const router = express.Router();

const ALLOWED_USERS = config.ALLOWED_USERS;
const CONSTANTS = {
  ALLOWED_EVENT_TYPES: config.ALLOWED_EVENT_TYPES,
  ALLOWED_DIAPER_SUBTYPES: config.ALLOWED_DIAPER_SUBTYPES,
  ALLOWED_USERS: config.ALLOWED_USERS,
  VALIDATION: config.VALIDATION
};

async function getEventsHandler(req, res) {
  try {
    const { filter } = req.query;
    const rawType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const typeFilter = rawType && rawType !== 'all' ? rawType : '';

    if (typeFilter && !CONSTANTS.ALLOWED_EVENT_TYPES.includes(typeFilter)) {
      return res.status(400).json({
        error: `Invalid event type. Allowed types: ${CONSTANTS.ALLOWED_EVENT_TYPES.join(', ')}`
      });
    }

    let events;

    if (filter) {
      if (typeof filter !== 'string') {
        return apiError(res, 400, 'Invalid filter format');
      }

      if (filter.length > CONSTANTS.VALIDATION.MAX_FILTER_LENGTH) {
        return apiError(res, 400, 'Filter parameter is too long');
      }

      let filterData;
      try {
        filterData = JSON.parse(filter);
      } catch (parseError) {
        return apiError(res, 400, 'Invalid filter format');
      }

      events = await Event.getFiltered(filterData);
    } else if (typeFilter) {
      events = await Event.getByType(typeFilter);
    } else {
      events = await Event.getAll();
    }

    if (typeFilter && filter) {
      events = events.filter(event => event.type === typeFilter);
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    apiError(res, 500, 'Failed to fetch events');
  }
}

router.get('/events', getEventsHandler);

router.post('/events', async (req, res) => {
  try {
    logger.log('Received event creation request:', req.body);
    const { type, amount, userName, sleepSubType, sleepStartTime, sleepEndTime, diaperSubtype, timestamp } = req.body;

    try {
      if (!type) {throw new Error('Event type is required');}
      validateEventType(type);

      if (!userName) {throw new Error('User name is required');}
      validateUserName(userName);

      if (timestamp) {
        validateTimestamp(timestamp);
      }

      if (type === 'diaper' && diaperSubtype) {
        validateDiaperSubtype(diaperSubtype);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    let eventTimestamp = null;
    if (timestamp) {
      const parsedTimestamp = new Date(timestamp);
      eventTimestamp = parsedTimestamp.toISOString();
    }

    if (type === 'milk') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount)) {
        return res.status(400).json({ error: 'Milk amount must be a valid number' });
      }

      try {
        validateMilkAmount(parsedAmount);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    if (type === 'diaper') {
      if (!diaperSubtype) {
        return res.status(400).json({ error: 'Diaper subtype is required (pee, poo, or both)' });
      }
      if (!CONSTANTS.ALLOWED_DIAPER_SUBTYPES.includes(diaperSubtype)) {
        return res.status(400).json({
          error: `Invalid diaper subtype. Allowed subtypes: ${CONSTANTS.ALLOWED_DIAPER_SUBTYPES.join(', ')}`
        });
      }
    }

    let calculatedAmount = null;
    let sleepStart = null;
    let sleepEnd = null;

    if (type === 'sleep') {
      if (sleepSubType === 'fall_asleep') {
        try {
          const result = await withTransaction(async (client) => {
            const incompleteSleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

            if (incompleteSleep) {
              return {
                success: false,
                error: `Cannot start new sleep session. User ${userName} already has an incomplete sleep session (started at ${incompleteSleep.sleep_start_time})`
              };
            }

            sleepStart = eventTimestamp || new Date().toISOString();

            const event = await Event.createWithClient(
              client,
              type,
              null,
              userName,
              sleepStart,
              null,
              null,
              eventTimestamp
            );

            return { success: true, event };
          });

          if (!result.success) {
            return res.status(400).json({ error: result.error });
          }

          return res.status(201).json(result.event);
        } catch (error) {
          console.error('Failed to create fall_asleep event:', error);
          return res.status(500).json({ error: 'Failed to create sleep session' });
        }
      } else if (sleepSubType === 'wake_up') {
        sleepEnd = eventTimestamp || new Date().toISOString();

        try {
          const result = await withTransaction(async (client) => {
            const lastFallAsleep = await Event.getLastIncompleteSleepForUpdate(
              userName,
              client
            );

            if (!lastFallAsleep) {
              return { success: false, error: 'No fall asleep event found' };
            }

            sleepStart = lastFallAsleep.sleep_start_time;

            try {
              validateSleepTimes(sleepStart, sleepEnd);
            } catch (validationError) {
              return { success: false, error: validationError.message };
            }

            const duration = Math.round(
              (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
            );
            calculatedAmount = duration > 0 ? duration : 1;

            const verification = verifySleepDuration(calculatedAmount);
            if (verification.requiresConfirmation) {
              return {
                success: false,
                error: verification.message,
                requiresConfirmation: true,
                verification
              };
            }

            const updateResult = await client.query(
              `UPDATE baby_events
               SET amount = $1, sleep_end_time = $2
               WHERE id = $3
               RETURNING *`,
              [calculatedAmount, sleepEnd, lastFallAsleep.id]
            );

            return {
              success: true,
              event: updateResult.rows[0],
              original: lastFallAsleep
            };
          });

          if (!result.success) {
            if (result.requiresConfirmation) {
              return res.status(422).json({
                error: result.error,
                requiresConfirmation: true,
                verification: result.verification
              });
            }
            return res.status(400).json({ error: result.error });
          }

          return res.status(201).json({
            ...result.original,
            amount: calculatedAmount,
            sleep_end_time: sleepEnd,
            ...result.event
          });
        } catch (error) {
          console.error('Failed to complete wake-up:', error);

          if (error.name === 'ConcurrentUpdateError') {
            return res.status(409).json({
              error: 'Sleep session was already completed by another request',
              code: 'CONCURRENT_UPDATE'
            });
          } else if (error.name === 'TransactionError') {
            return res.status(500).json({
              error: 'Transaction failed, please try again',
              code: 'TRANSACTION_ERROR'
            });
          } else if (error.name === 'DatabaseError') {
            return res.status(500).json({
              error: 'Database error occurred',
              code: 'DATABASE_ERROR'
            });
          }

          return res.status(500).json({
            error: 'Failed to complete sleep session',
            code: 'INTERNAL_ERROR'
          });
        }
      } else {
        if (!amount || amount <= 0 || amount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
          return res.status(400).json({
            error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
          });
        }
        calculatedAmount = parseInt(amount);

        const verification = verifySleepDuration(calculatedAmount);
        if (verification.requiresConfirmation) {
          return res.status(422).json({
            error: verification.message,
            requiresConfirmation: true,
            verification
          });
        }
      }
    } else {
      calculatedAmount = type === 'milk' ? parseInt(amount) : null;
      if (type === 'milk' && (Number.isNaN(calculatedAmount) || calculatedAmount <= 0 || calculatedAmount > CONSTANTS.VALIDATION.MAX_MILK_AMOUNT)) {
        return res.status(400).json({
          error: `Milk amount must be between 1 and ${CONSTANTS.VALIDATION.MAX_MILK_AMOUNT} ml`
        });
      }

      if (type !== 'sleep') {
        const sleepEnd = eventTimestamp || new Date().toISOString();
        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await withTransaction(async (client) => {
              const incompleteSleeps = await client.query(
                `SELECT * FROM baby_events
                 WHERE type = 'sleep'
                   AND sleep_start_time IS NOT NULL
                   AND sleep_end_time IS NULL
                 ORDER BY timestamp DESC
                 FOR UPDATE`
              );

              const laterEndSleeps = await client.query(
                `SELECT * FROM baby_events
                 WHERE type = 'sleep'
                   AND sleep_start_time IS NOT NULL
                   AND sleep_end_time IS NOT NULL
                   AND sleep_end_time > $1
                 ORDER BY timestamp DESC
                 FOR UPDATE`,
                [sleepEnd]
              );

              const allSleeps = [...incompleteSleeps.rows, ...laterEndSleeps.rows];

              for (const sleep of allSleeps) {
                const sleepStart = sleep.sleep_start_time;

                try {
                  validateSleepTimes(sleepStart, sleepEnd);
                } catch (validationError) {
                  console.error(`Auto-completion validation failed for sleep ${sleep.id}:`, validationError.message);
                  continue;
                }

                const duration = Math.round(
                  (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
                );
                const sleepAmount = duration > 0 ? duration : 1;

                const verification = verifySleepDuration(sleepAmount);
                if (verification.requiresConfirmation) {
                  console.warn(
                    `⚠️ Auto-completed sleep event ${sleep.id} has unusual duration: ${sleepAmount} minutes`,
                    `(${verification.issue}) - ${verification.message}`
                  );
                }

                await client.query(
                  `UPDATE baby_events
                   SET amount = $1, sleep_end_time = $2
                   WHERE id = $3`,
                  [sleepAmount, sleepEnd, sleep.id]
                );

                const isCorrection = sleep.sleep_end_time !== null;
                logger.log(
                  `Auto-${isCorrection ? 'corrected' : 'completed'} sleep event ${sleep.id} (by ${sleep.user_name}) ` +
                  `with ${type} event at ${sleepEnd} ` +
                  `(previous end: ${sleep.sleep_end_time || 'null'})`
                );
              }
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const isRetryable = error.name === 'DatabaseError' ||
                               error.name === 'TransactionError' ||
                               error.name === 'ConcurrentUpdateError' ||
                               (error.code && (error.code === '40P01' || error.code === '55P03'));
            if (attempt < maxRetries && isRetryable) {
              const delayMs = 100 * Math.pow(2, attempt - 1);
              console.warn(`Auto-completion transaction failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms:`, error.message);
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            }
            break;
          }
        }

        if (lastError) {
          console.error(
            'Failed to auto-complete sleep after all retries:',
            lastError.message
          );
        }
      }
    }

    let eventSubtype = null;
    if (type === 'diaper') {
      eventSubtype = diaperSubtype;
    }
    if (type === 'poo') {
      eventSubtype = 'poo';
    }

    logger.log('Creating event with data:', { type, calculatedAmount, userName, sleepStart, sleepEnd, subtype: eventSubtype, timestamp: eventTimestamp });
    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd, eventSubtype, eventTimestamp);
    logger.log('Event created successfully:', event);
    res.status(201).json(event);
  } catch (error) {
    console.error('❌ Error creating event:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Environment info:', {
      DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
      NODE_ENV: process.env.NODE_ENV,
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT
    });
    apiError(res, 500, 'Failed to create event');
  }
});

router.get('/stats/today', async (req, res) => {
  try {
    const stats = await Event.getTodayStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    apiError(res, 500, 'Failed to fetch stats');
  }
});

router.get('/sleep/active', async (req, res) => {
  try {
    const activeSessions = [];
    for (const user of ALLOWED_USERS) {
      const incompleteSleep = await Event.getLastIncompleteSleep(user);
      if (incompleteSleep) {
        const startTime = new Date(incompleteSleep.sleep_start_time);
        const elapsedMs = Date.now() - startTime.getTime();
        const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

        activeSessions.push({
          id: incompleteSleep.id,
          userName: incompleteSleep.user_name,
          startTime: incompleteSleep.sleep_start_time,
          elapsedMinutes,
          elapsedFormatted: elapsedMinutes >= 60
            ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`
            : `${elapsedMinutes}m`
        });
      }
    }

    res.json({
      success: true,
      hasActiveSleep: activeSessions.length > 0,
      sessions: activeSessions
    });
  } catch (error) {
    console.error('Error checking active sleep:', error);
    apiError(res, 500, 'Failed to check active sleep');
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const eventId = parseInt(id, 10);
    if (Number.isNaN(eventId)) {
      return apiError(res, 400, 'Invalid event id');
    }

    await Event.delete(eventId);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    if (error.message === 'Event not found') {
      apiError(res, 404, 'Event not found');
    } else {
      apiError(res, 500, 'Failed to delete event');
    }
  }
});

async function updateEventHandler(req, res) {
  try {
    const { id } = req.params;
    const { type, amount, diaperSubtype, timestamp } = req.body;

    const eventId = parseInt(id, 10);

    if (Number.isNaN(eventId)) {
      return apiError(res, 400, 'Invalid event id');
    }

    if (!type) {
      return apiError(res, 400, 'Event type is required');
    }

    if (!CONSTANTS.ALLOWED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({
        error: `Invalid event type. Allowed types: ${CONSTANTS.ALLOWED_EVENT_TYPES.join(', ')}`
      });
    }

    const existingEvent = await Event.getById(eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    let normalizedAmount = null;
    let normalizedTimestamp = null;

    if (type === 'milk') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > CONSTANTS.VALIDATION.MAX_MILK_AMOUNT) {
        return res.status(400).json({
          error: `Milk amount is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_MILK_AMOUNT} ml`
        });
      }
      normalizedAmount = parsedAmount;
    } else if (type === 'sleep') {
      const parsedAmount = parseInt(amount, 10);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
        return res.status(400).json({
          error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
        });
      }
      normalizedAmount = parsedAmount;
    }

    if (timestamp !== undefined) {
      if (!timestamp) {
        return res.status(400).json({ error: 'Timestamp is required when provided' });
      }

      const parsedTimestamp = new Date(timestamp);
      if (Number.isNaN(parsedTimestamp.getTime())) {
        return res.status(400).json({ error: 'Invalid timestamp format' });
      }
      if (parsedTimestamp > new Date()) {
        return res.status(400).json({ error: 'Timestamp cannot be in the future' });
      }
      normalizedTimestamp = parsedTimestamp.toISOString();
    }

    let eventSubtype = null;
    if (type === 'diaper') {
      if (!diaperSubtype) {
        return res.status(400).json({ error: 'Diaper subtype is required (pee, poo, or both)' });
      }
      if (!CONSTANTS.ALLOWED_DIAPER_SUBTYPES.includes(diaperSubtype)) {
        return res.status(400).json({
          error: `Invalid diaper subtype. Allowed subtypes: ${CONSTANTS.ALLOWED_DIAPER_SUBTYPES.join(', ')}`
        });
      }
      eventSubtype = diaperSubtype;
    } else if (type === 'poo') {
      eventSubtype = 'poo';
    }

    const isSleepEvent = type === 'sleep';
    const existingSleepStart = existingEvent.sleep_start_time ?? existingEvent.sleepStartTime ?? null;
    const existingSleepEnd = existingEvent.sleep_end_time ?? existingEvent.sleepEndTime ?? null;
    const existingTimestamp = existingEvent.timestamp ? new Date(existingEvent.timestamp).toISOString() : null;

    let updatedSleepStart = null;
    let updatedSleepEnd = null;
    let timestampForUpdate = normalizedTimestamp || existingTimestamp;

    if (isSleepEvent) {
      const baseSleepStart = normalizedTimestamp || existingSleepStart || existingTimestamp;
      updatedSleepStart = baseSleepStart;

      const durationMinutes = normalizedAmount ?? (Number.isFinite(existingEvent.amount) ? Number(existingEvent.amount) : null);
      if (baseSleepStart && Number.isFinite(durationMinutes)) {
        const calculatedEnd = new Date(baseSleepStart);
        calculatedEnd.setMinutes(calculatedEnd.getMinutes() + durationMinutes);
        updatedSleepEnd = calculatedEnd.toISOString();
      } else if (existingSleepEnd) {
        updatedSleepEnd = existingSleepEnd;
      } else {
        updatedSleepEnd = null;
      }

      timestampForUpdate = normalizedTimestamp || baseSleepStart || existingTimestamp;
    }

    const event = await Event.update(
      eventId,
      type,
      normalizedAmount,
      updatedSleepStart,
      updatedSleepEnd,
      eventSubtype,
      timestampForUpdate
    );
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    if (error.message === 'Event not found') {
      apiError(res, 404, 'Event not found');
    } else {
      apiError(res, 500, 'Failed to update event');
    }
  }
}

router.put('/events/:id', updateEventHandler);

router.post('/events/confirmed-sleep', async (req, res) => {
  try {
    logger.log('Received confirmed sleep event creation request:', req.body);
    const { type, amount, userName, sleepSubType, sleepStartTime, sleepEndTime, timestamp } = req.body;

    if (!type || type !== 'sleep') {
      return apiError(res, 400, 'Event type must be sleep');
    }

    if (!userName) {
      return apiError(res, 400, 'User name is required');
    }

    validateUserName(userName);

    if (timestamp) {
      validateTimestamp(timestamp);
    }

    let calculatedAmount = null;
    let sleepStart = null;
    let sleepEnd = null;

    if (sleepSubType === 'fall_asleep') {
      try {
        const result = await withTransaction(async (client) => {
          const incompleteSleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

          if (incompleteSleep) {
            return {
              success: false,
              error: `Cannot start new sleep session. User ${userName} already has an incomplete sleep session (started at ${incompleteSleep.sleep_start_time})`
            };
          }

          sleepStart = timestamp || new Date().toISOString();

          const event = await Event.createWithClient(
            client,
            'sleep',
            null,
            userName,
            sleepStart,
            null,
            null,
            timestamp
          );

          return { success: true, event };
        });

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        return res.status(201).json(result.event);
      } catch (error) {
        console.error('Failed to create confirmed fall_asleep event:', error);
        return res.status(500).json({ error: 'Failed to create sleep session', details: error.message });
      }
    } else if (sleepSubType === 'wake_up') {
      sleepEnd = timestamp || new Date().toISOString();

      try {
        const result = await withTransaction(async (client) => {
          const lastFallAsleep = await Event.getLastIncompleteSleepForUpdate(userName, client);

          if (!lastFallAsleep) {
            return { success: false, error: 'No fall asleep event found' };
          }

          sleepStart = lastFallAsleep.sleep_start_time;

          try {
            validateSleepTimes(sleepStart, sleepEnd);
          } catch (validationError) {
            return { success: false, error: validationError.message };
          }

          const duration = Math.round(
            (new Date(sleepEnd) - new Date(sleepStart)) / (1000 * 60)
          );
          calculatedAmount = duration > 0 ? duration : 1;

          const updateResult = await client.query(
            `UPDATE baby_events
             SET amount = $1, sleep_end_time = $2
             WHERE id = $3
             RETURNING *`,
            [calculatedAmount, sleepEnd, lastFallAsleep.id]
          );

          return {
            success: true,
            event: updateResult.rows[0],
            original: lastFallAsleep
          };
        });

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        return res.status(201).json({
          ...result.original,
          amount: calculatedAmount,
          sleep_end_time: sleepEnd,
          ...result.event
        });
      } catch (error) {
        console.error('Failed to complete confirmed wake-up:', error);
        return res.status(500).json({ error: 'Failed to complete sleep session' });
      }
    } else {
      if (!amount || amount <= 0 || amount > CONSTANTS.VALIDATION.MAX_SLEEP_DURATION) {
        return res.status(400).json({
          error: `Sleep duration is required and must be between 1 and ${CONSTANTS.VALIDATION.MAX_SLEEP_DURATION} minutes`
        });
      }
      calculatedAmount = parseInt(amount);
    }

    const event = await Event.create(type, calculatedAmount, userName, sleepStart, sleepEnd, null, timestamp);
    logger.log('Confirmed sleep event created successfully:', event);
    res.status(201).json(event);

  } catch (error) {
    console.error('❌ Error creating confirmed sleep event:', error);
    apiError(res, 500, 'Failed to create confirmed sleep event');
  }
});

module.exports = router;
module.exports.getEventsHandler = getEventsHandler;
module.exports.updateEventHandler = updateEventHandler;
