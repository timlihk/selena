const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/ai-insights',
  method: 'GET'
};

console.log('Testing AI insights API...');

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response length:', data.length);
    try {
      const json = JSON.parse(data);
      console.log('Success:', json.success);
      if (json.success) {
        console.log('AI Insights count:', json.aiEnhanced?.insights?.length || 0);
        console.log('Statistical patterns extracted:', !!json.statistical);
        console.log('Data days:', json.dataQuality?.days || 'unknown');
      } else {
        console.log('Error:', json.error);
        console.log('Message:', json.message);
      }
    } catch (e) {
      console.log('Raw response (first 500 chars):', data.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.end();