const assert = require('assert');

process.env.NODE_ENV = 'test';
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

async function run() {
  await initializeDatabase();
  resetMemoryStore();

  await testInvalidFilterReturns400();
  await testSleepUpdatePreservesTimestamps();

  console.log('All tests passed');
}

run().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
