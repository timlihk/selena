#!/usr/bin/env node

// Test script to verify sleep duration verification
const { verifySleepDuration } = require('./server.js');

console.log('🧪 Testing sleep duration verification...\n');

// Test cases
const testCases = [
  { duration: 5, expected: 'too_short' },
  { duration: 9, expected: 'too_short' },
  { duration: 10, expected: null },
  { duration: 15, expected: null },
  { duration: 299, expected: null },
  { duration: 300, expected: null },
  { duration: 301, expected: 'too_long' },
  { duration: 400, expected: 'too_long' },
  { duration: 720, expected: 'too_long' }
];

console.log('📊 Test Results:');
testCases.forEach(test => {
  const result = verifySleepDuration(test.duration);
  const status = result.requiresConfirmation ? '⚠️ REQUIRES CONFIRMATION' : '✅ OK';
  const issue = result.issue || 'none';

  console.log(`   ${test.duration} minutes: ${status} (${issue})`);
  if (result.requiresConfirmation) {
    console.log(`      Message: ${result.message}`);
  }
});

console.log('\n📋 Summary:');
const requiresConfirmation = testCases.filter(test => verifySleepDuration(test.duration).requiresConfirmation);
console.log(`   • ${requiresConfirmation.length}/${testCases.length} test cases require confirmation`);
console.log('   • Thresholds: <10 minutes or >300 minutes (5 hours)');