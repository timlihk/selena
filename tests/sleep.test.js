const request = require('supertest');
const { app } = require('../server');
const { Event, resetMemoryStore, initializeDatabase } = require('../database');

process.env.NODE_ENV = 'test';
process.env.BABY_HOME_TIMEZONE = 'Asia/Hong_Kong';
delete process.env.DATABASE_URL;

beforeAll(async () => {
  await initializeDatabase();
});

beforeEach(() => {
  resetMemoryStore();
});

describe('Sleep Overlap Validation', () => {

  // Pre-populate database with an existing sleep session
  beforeEach(async () => {
    const existingSleepStart = new Date('2025-11-01T10:00:00Z').toISOString();
    const existingSleepEnd = new Date('2025-11-01T12:00:00Z').toISOString();
    await Event.create('sleep', 120, 'Tim', existingSleepStart, existingSleepEnd);
  });

  it('should return 409 when creating a new legacy sleep that overlaps', async () => {
    const overlappingStart = new Date('2025-11-01T11:00:00Z').toISOString(); // Starts during existing sleep

    const response = await request(app)
      .post('/api/events')
      .send({
        type: 'sleep',
        amount: 90, // 90 minutes, ends at 12:30, overlapping
        userName: 'Tim',
        timestamp: overlappingStart,
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe('OVERLAP_DETECTED');
  });

  it('should return 409 when completing a sleep session that overlaps with another', async () => {
    // Create another completed sleep session to conflict with
    const anotherSleepStart = new Date('2025-11-01T14:00:00Z').toISOString();
    const anotherSleepEnd = new Date('2025-11-01T15:00:00Z').toISOString();
    await Event.create('sleep', 60, 'Angie', anotherSleepStart, anotherSleepEnd);

    // Start a new sleep session
    const fallAsleepTime = new Date('2025-11-01T13:30:00Z').toISOString();
    await request(app)
      .post('/api/events')
      .send({
        type: 'sleep',
        sleepSubType: 'fall_asleep',
        userName: 'Angie',
        timestamp: fallAsleepTime,
      });

    // Now, wake up at a time that causes an overlap
    const wakeUpTime = new Date('2025-11-01T14:30:00Z').toISOString(); // Overlaps with the 14:00-15:00 sleep
    const response = await request(app)
      .post('/api/events')
      .send({
        type: 'sleep',
        sleepSubType: 'wake_up',
        userName: 'Angie',
        timestamp: wakeUpTime,
      });

    // In the 'wake_up' flow, the error is returned from within the transaction logic
    expect(response.statusCode).toBe(400); // The transaction returns a generic 400
    expect(response.body.error).toContain('overlaps with existing sleep session');
  });


  it('should return 409 when updating a sleep session to overlap with another', async () => {
    // This is the event we will NOT update, but will cause the overlap
    const secondSleepStart = new Date('2025-11-01T14:00:00Z').toISOString();
    const secondSleepEnd = new Date('2025-11-01T15:00:00Z').toISOString();
    const secondEvent = await Event.create('sleep', 60, 'Tim', secondSleepStart, secondSleepEnd);

    // This is the event that exists from the beforeEach block, which we WILL update
    const eventToUpdate = (await Event.getAll()).find(e => e.amount === 120);

    // Attempt to update the first event to overlap with the second one
    const overlappingTimestamp = new Date('2025-11-01T13:30:00Z').toISOString();
    const response = await request(app)
      .put(`/api/events/${eventToUpdate.id}`)
      .send({
        type: 'sleep',
        amount: 61, // 61 mins, ends at ~14:31, overlapping the second event
        timestamp: overlappingTimestamp,
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe('OVERLAP_DETECTED');
  });

  it('should allow creation of a valid, non-overlapping legacy sleep event', async () => {
    const validStart = new Date('2025-11-01T13:00:00Z').toISOString(); // Starts after existing sleep

    const response = await request(app)
      .post('/api/events')
      .send({
        type: 'sleep',
        amount: 60, // 60 minutes, ends at 14:00
        userName: 'Tim',
        timestamp: validStart,
      });

    expect(response.statusCode).toBe(201);
  });

  it('should allow updating a sleep session with valid, non-overlapping times', async () => {
    const eventToUpdate = (await Event.getAll()).find(e => e.amount === 120);
    const validTimestamp = new Date('2025-11-01T09:00:00Z').toISOString(); // Change start time

    const response = await request(app)
      .put(`/api/events/${eventToUpdate.id}`)
      .send({
        type: 'sleep',
        amount: 30, // 30 mins, ends at 09:30, no overlap
        timestamp: validTimestamp,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.amount).toBe(30);
    expect(response.body.sleep_start_time).toBe(validTimestamp);
  });
});
