const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.BABY_HOME_TIMEZONE = 'Asia/Hong_Kong';
delete process.env.DATABASE_URL;

const { getEventsHandler, updateEventHandler } = require('../server');
const { initializeDatabase, Event, resetMemoryStore } = require('../database');

function createMockResponse() {
  return {
    statusCode: 200,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonData = payload;
      return this;
    }
  };
}

async function testInvalidFilterReturns400() {
  resetMemoryStore();
  const req = {
    query: {
      filter: 'notjson'
    }
  };
  const res = createMockResponse();

  await getEventsHandler(req, res);

  assert.strictEqual(res.statusCode, 400, 'Expected HTTP 400 for invalid filter');
  assert.deepStrictEqual(res.jsonData, { error: 'Invalid filter format' });
}

async function testTypeFilterReturnsOnlyRequestedType() {
  resetMemoryStore();
  await Event.create('milk', 120, 'Tim');
  await Event.create('poo', null, 'Tim');
  await Event.create('milk', 90, 'Angie');

  const req = {
    query: {
      type: 'milk'
    }
  };
  const res = createMockResponse();

  await getEventsHandler(req, res);

  assert.strictEqual(res.statusCode, 200, 'Type filter should return HTTP 200');
  assert(Array.isArray(res.jsonData), 'Response should be an array');
  assert.strictEqual(res.jsonData.length, 2, 'Should return only milk events');
  assert(res.jsonData.every(event => event.type === 'milk'), 'All events should be milk type');
}

async function testSleepUpdatePreservesTimestamps() {
  resetMemoryStore();
  const initialStart = new Date('2024-01-01T00:00:00Z').toISOString();
  const initialEnd = new Date('2024-01-01T01:00:00Z').toISOString();

  const createdEvent = await Event.create('sleep', 30, 'Tim', initialStart, initialEnd);

  const req = {
    params: { id: createdEvent.id.toString() },
    body: { type: 'sleep', amount: 45 }
  };
  const res = createMockResponse();

  await updateEventHandler(req, res);

  assert.strictEqual(res.statusCode, 200, 'Sleep update should succeed');
  assert.strictEqual(res.jsonData.amount, 45, 'Sleep amount should update');
  assert.strictEqual(res.jsonData.sleep_start_time, initialStart, 'Sleep start should remain unchanged');
  assert.strictEqual(res.jsonData.sleep_end_time, initialEnd, 'Sleep end should remain unchanged');
}

async function testMemoryStorePreservesProvidedTimestamp() {
  resetMemoryStore();
  const customTimestamp = '2024-02-01T12:34:00.000Z';

  const createdEvent = await Event.create('milk', 90, 'Tim', null, null, null, customTimestamp);
  assert.strictEqual(createdEvent.timestamp, customTimestamp, 'Created event should use provided timestamp');

  const events = await Event.getAll();
  assert.strictEqual(events.length, 1, 'Should have one event stored');
  assert.strictEqual(events[0].timestamp, customTimestamp, 'Stored event should retain provided timestamp');
}

async function testDateFilterRespectsTimezoneBoundaries() {
  resetMemoryStore();

  // Asia/Hong_Kong is UTC+8
  await Event.create('milk', 60, 'Tim', null, null, null, '2024-03-04T18:30:00.000Z'); // 2024-03-05 02:30 local
  await Event.create('milk', 80, 'Angie', null, null, null, '2024-03-05T05:00:00.000Z'); // 2024-03-05 13:00 local
  await Event.create('milk', 50, 'Tim', null, null, null, '2024-03-05T16:30:00.000Z'); // 2024-03-06 00:30 local (should be excluded)

  const req = {
    query: {
      filter: JSON.stringify({ startDate: '2024-03-05', endDate: '2024-03-05' })
    }
  };
  const res = createMockResponse();

  await getEventsHandler(req, res);

  assert.strictEqual(res.statusCode, 200, 'Filter request should succeed');
  assert.strictEqual(res.jsonData.length, 2, 'Should include only events that fall on 2024-03-05 in home timezone');
  const timestamps = res.jsonData.map(event => event.timestamp).sort();
  assert.deepStrictEqual(
    timestamps,
    ['2024-03-04T18:30:00.000Z', '2024-03-05T05:00:00.000Z'],
    'Filter should include overnight events using timezone boundaries'
  );
}

async function run() {
  await initializeDatabase();

  await testInvalidFilterReturns400();
  await testTypeFilterReturnsOnlyRequestedType();
  await testSleepUpdatePreservesTimestamps();
  await testMemoryStorePreservesProvidedTimestamp();
  await testDateFilterRespectsTimezoneBoundaries();

  console.log('All tests passed');
}

run().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
