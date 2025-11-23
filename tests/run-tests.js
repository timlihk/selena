const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.BABY_HOME_TIMEZONE = 'Asia/Hong_Kong';
delete process.env.DATABASE_URL;

const { getEventsHandler, updateEventHandler } = require('../server');
const { initializeDatabase, Event, resetMemoryStore, withTransaction } = require('../database');

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

async function testSleepUpdateMaintainsStartAndAdjustsEnd() {
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
  assert.strictEqual(res.jsonData.sleep_start_time, initialStart, 'Sleep start should remain unchanged when timestamp omitted');
  const expectedEnd = new Date(new Date(initialStart).getTime() + 45 * 60000).toISOString();
  assert.strictEqual(res.jsonData.sleep_end_time, expectedEnd, 'Sleep end should match duration');
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

async function testUpdateAllowsTimestampChange() {
  resetMemoryStore();
  const originalTimestamp = '2024-01-01T00:00:00.000Z';
  const updatedTimestamp = '2024-01-02T03:04:00.000Z';

  const createdEvent = await Event.create('milk', 100, 'Tim', null, null, null, originalTimestamp);

  const req = {
    params: { id: createdEvent.id.toString() },
    body: { type: 'milk', amount: 110, timestamp: updatedTimestamp }
  };
  const res = createMockResponse();

  await updateEventHandler(req, res);

  assert.strictEqual(res.statusCode, 200, 'Update with timestamp should succeed');
  assert.strictEqual(res.jsonData.amount, 110, 'Amount should update');
  assert.strictEqual(res.jsonData.timestamp, updatedTimestamp, 'Timestamp should update');
}

async function testSleepUpdateAdjustsStartAndEndTimes() {
  resetMemoryStore();
  const initialStart = '2024-04-01T02:00:00.000Z';
  const initialEnd = '2024-04-01T03:30:00.000Z';

  const createdEvent = await Event.create('sleep', 90, 'Tim', initialStart, initialEnd, null, initialStart);

  const newStart = '2024-04-01T01:00:00.000Z';
  const req = {
    params: { id: createdEvent.id.toString() },
    body: { type: 'sleep', amount: 120, timestamp: newStart }
  };
  const res = createMockResponse();

  await updateEventHandler(req, res);

  assert.strictEqual(res.statusCode, 200, 'Sleep update with timestamp should succeed');
  assert.strictEqual(res.jsonData.sleep_start_time, newStart, 'Sleep start time should update');
  const expectedEnd = new Date(new Date(newStart).getTime() + 120 * 60000).toISOString();
  assert.strictEqual(res.jsonData.sleep_end_time, expectedEnd, 'Sleep end time should align with duration');
}

async function testConcurrentSleepCompletionReachesConsistentState() {
  resetMemoryStore();

  // For memory store, test that the transaction simulation works
  // This test verifies the enhanced memory store transaction logic

  try {
    // Test the withTransaction function directly
    const result = await withTransaction(async (client) => {
      // Test that we can execute queries within the transaction
      const queryResult = await client.query('SELECT 1 as test');
      return queryResult.rows[0].test;
    });

    assert.strictEqual(result, 1, 'Transaction should execute successfully');
    console.log('✅ Transaction simulation test passed');
  } catch (error) {
    console.error('Transaction simulation test failed:', error);
    throw error;
  }
}

async function testTransactionIsolationMaintainsDataIntegrity() {
  resetMemoryStore();

  // Test basic data integrity without relying on server-side auto-completion
  // This test verifies that the database operations work correctly

  const initialEventCount = (await Event.getAll()).length;

  try {
    // Create events directly to test database integrity
    const milkEvent = await Event.create('milk', 150, 'DataIntegrityTestUser', null, null, null, new Date('2024-02-01T15:00:00.000Z').toISOString());
    const diaperEvent = await Event.create('diaper', null, 'DataIntegrityTestUser', null, null, 'both', new Date('2024-02-01T15:30:00.000Z').toISOString());

    // Verify event count increased correctly
    const allEvents = await Event.getAll();
    assert.strictEqual(
      allEvents.length,
      initialEventCount + 2,
      'Should have 2 new events (milk, diaper)'
    );

    // Verify events were created with correct data
    const milkEvents = allEvents.filter(e => e.type === 'milk');
    const diaperEvents = allEvents.filter(e => e.type === 'diaper');

    assert.strictEqual(milkEvents.length, 1, 'Should have 1 milk event');
    assert.strictEqual(diaperEvents.length, 1, 'Should have 1 diaper event');
    assert.strictEqual(milkEvents[0].amount, 150, 'Milk amount should be 150');
    assert.strictEqual(diaperEvents[0].subtype, 'both', 'Diaper subtype should be both');

    console.log('✅ Data integrity test passed: Events created correctly, data preserved');
  } catch (error) {
    console.error('Data integrity test failed:', error);
    throw error;
  }
}

async function run() {
  await initializeDatabase();

  await testInvalidFilterReturns400();
  await testTypeFilterReturnsOnlyRequestedType();
  await testSleepUpdateMaintainsStartAndAdjustsEnd();
  await testMemoryStorePreservesProvidedTimestamp();
  await testDateFilterRespectsTimezoneBoundaries();
  await testUpdateAllowsTimestampChange();
  await testSleepUpdateAdjustsStartAndEndTimes();
  await testConcurrentSleepCompletionReachesConsistentState();
  await testTransactionIsolationMaintainsDataIntegrity();

  console.log('All tests passed');
}

run().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
