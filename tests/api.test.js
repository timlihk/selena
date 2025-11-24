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

describe('GET /api/events', () => {
  it('should return 400 for invalid filter format', async () => {
    const response = await request(app)
      .get('/api/events?filter=notjson');

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid filter format' });
  });

  it('should return only events of the requested type', async () => {
    await Event.create('milk', 120, 'Tim');
    await Event.create('poo', null, 'Tim');
    await Event.create('milk', 90, 'Angie');

    const response = await request(app)
      .get('/api/events?type=milk');

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(2);
    expect(response.body.every(event => event.type === 'milk')).toBe(true);
  });

  it('should filter events by date, respecting timezone', async () => {
    // Asia/Hong_Kong is UTC+8
    await Event.create('milk', 60, 'Tim', null, null, null, '2025-03-04T18:30:00.000Z'); // 2025-03-05 02:30 local
    await Event.create('milk', 80, 'Angie', null, null, null, '2025-03-05T05:00:00.000Z'); // 2025-03-05 13:00 local
    await Event.create('milk', 50, 'Tim', null, null, null, '2025-03-05T16:30:00.000Z'); // 2025-03-06 00:30 local (should be excluded)

    const filter = JSON.stringify({ startDate: '2025-03-05', endDate: '2025-03-05' });
    const response = await request(app)
      .get(`/api/events?filter=${encodeURIComponent(filter)}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBe(2);
    const timestamps = response.body.map(event => event.timestamp).sort();
    expect(timestamps).toEqual(
      ['2025-03-04T18:30:00.000Z', '2025-03-05T05:00:00.000Z']
    );
  });
});

describe('POST /api/events', () => {
  it('should preserve the provided timestamp when creating an event', async () => {
    const customTimestamp = '2025-02-01T12:34:00.000Z';
    const response = await request(app)
      .post('/api/events')
      .send({
        type: 'milk',
        amount: 90,
        userName: 'Tim',
        timestamp: customTimestamp,
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.timestamp).toBe(customTimestamp);

    const events = await Event.getAll();
    expect(events.length).toBe(1);
    expect(events[0].timestamp).toBe(customTimestamp);
  });
});

describe('PUT /api/events/:id', () => {
  it('should update sleep amount and end time correctly', async () => {
    const initialStart = new Date('2025-01-01T00:00:00Z').toISOString();
    const initialEnd = new Date('2025-01-01T01:00:00Z').toISOString();
    const createdEvent = await Event.create('sleep', 60, 'Tim', initialStart, initialEnd);

    const response = await request(app)
      .put(`/api/events/${createdEvent.id}`)
      .send({ type: 'sleep', amount: 45 });

    expect(response.statusCode).toBe(200);
    expect(response.body.amount).toBe(45);
    expect(response.body.sleep_start_time).toBe(initialStart);
    const expectedEnd = new Date(new Date(initialStart).getTime() + 45 * 60000).toISOString();
    expect(response.body.sleep_end_time).toBe(expectedEnd);
  });

  it('should allow an event timestamp to be updated', async () => {
    const originalTimestamp = '2025-01-01T00:00:00.000Z';
    const updatedTimestamp = '2025-01-02T03:04:00.000Z';
    const createdEvent = await Event.create('milk', 100, 'Tim', null, null, null, originalTimestamp);

    const response = await request(app)
      .put(`/api/events/${createdEvent.id}`)
      .send({ type: 'milk', amount: 110, timestamp: updatedTimestamp });

    expect(response.statusCode).toBe(200);
    expect(response.body.amount).toBe(110);
    expect(response.body.timestamp).toBe(updatedTimestamp);
  });

  it('should update sleep start and end times when timestamp is changed', async () => {
    const initialStart = '2025-04-01T02:00:00.000Z';
    const initialEnd = '2025-04-01T03:30:00.000Z';
    const createdEvent = await Event.create('sleep', 90, 'Tim', initialStart, initialEnd, null, initialStart);

    const newStart = '2025-04-01T01:00:00.000Z';
    const response = await request(app)
      .put(`/api/events/${createdEvent.id}`)
      .send({ type: 'sleep', amount: 120, timestamp: newStart });

    expect(response.statusCode).toBe(200);
    expect(response.body.sleep_start_time).toBe(newStart);
    const expectedEnd = new Date(new Date(newStart).getTime() + 120 * 60000).toISOString();
    expect(response.body.sleep_end_time).toBe(expectedEnd);
  });
});

describe('GET /api/stats', () => {
  it('should return 200 and an array for weekly stats', async () => {
    const response = await request(app).get('/api/stats/weekly');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
  });

  it('should return 200 and an array for monthly stats', async () => {
    const response = await request(app).get('/api/stats/monthly');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
  });
});
