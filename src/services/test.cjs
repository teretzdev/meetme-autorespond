// test.cjs
const assert = require('assert');
const http = require('http');
const { exec } = require('child_process');
const path = require('path');

// Server URL
const serverUrl = 'http://localhost:' + (process.env.PORT || 3001); // Make sure this is correct!

// Test cases
const testCases = [
  {
    description: 'GET / - should return index.html',
    method: 'GET',
    path: '/',
    expectedStatusCode: 200,
  },
  {
    description: 'GET /api/history/test-room - should return empty history',
    method: 'GET',
    path: '/api/history/test-room',
    expectedStatusCode: 200,
    expectedBody: [],
  },
  {
    description: 'POST /api/chat - missing fields, should return error',
    method: 'POST',
    path: '/api/chat',
    expectedStatusCode: 400,
    requestData: {}, // Missing room, sender, message
    expectedBody: { error: 'Missing required fields' },
  },
  {
    description: 'POST /api/chat - valid message, should return reply',
    method: 'POST',
    path: '/api/chat',
    expectedStatusCode: 200,
    requestData: {
      room: 'test-room',
      sender: 'test-user',
      message: 'Hello there!',
    },
  },
  {
    description: 'GET /api/history/test-room - should return history with one message',
    method: 'GET',
    path: '/api/history/test-room',
    expectedStatusCode: 200,
    expectedBodyLength: 1,
  },
  {
    description: 'GET /api/history/test-room - should return empty history',
    method: 'GET',
    path: '/api/history/test-room',
    expectedStatusCode: 200,
    expectedBody: [],
  },
  {
    description: 'POST /api/chat - missing fields, should return error',
    method: 'POST',
    path: '/api/chat',
    expectedStatusCode: 400,
    requestData: {}, // Missing room, sender, message
    expectedBody: { error: 'Missing required fields' },
  },
  {
    description: 'POST /api/chat - valid message, should return reply',
    method: 'POST',
    path: '/api/chat',
    expectedStatusCode: 200,
    requestData: {
      room: 'test-room',
      sender: 'test-user',
      message: 'Hello there!',
    },
  },
  {
    description: 'GET /api/history/test-room - should return history with one message',
    method: 'GET',
    path: '/api/history/test-room',
    expectedStatusCode: 200,
    expectedBodyLength: 1,
  },
];

let serverProcess;

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = exec('node main.js', { cwd: path.resolve(__dirname, '../../') });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
      if (data.includes('Server listening on port')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
      reject(data);
    });

    serverProcess.on('close', (code) => {
      console.log(`Server process exited with code ${code}`);
    });
  });
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
  }
}

(async () => {
  await startServer();
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    try {
      const fullUrl = `${serverUrl}${testCase.path}`; // Construct the full URL
      console.log(`[${new Date().toLocaleTimeString()}] Testing: ${testCase.method} ${fullUrl}`); 
      await testHttp(testCase);
      console.log(`\x1b[32m✓ PASS\x1b[0m: ${testCase.description}`);
      passed++;
    } catch (error) {
      console.error(`\x1b[31m✗ FAIL\x1b[0m: ${testCase.description}`);
      console.error(error);
      failed++;
    }
  }

  console.log(`\n\x1b[32m${passed} tests passed\x1b[0m`);
  console.log(`\x1b[31m${failed} tests failed\x1b[0m`);

  await stopServer();
  process.exit(failed > 0 ? 1 : 0);
})();

// Helper function to test HTTP endpoints
async function testHttp(testCase) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'localhost',
      port: 3000,
      path: testCase.path,
      method: testCase.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          assert.strictEqual(
            res.statusCode,
            testCase.expectedStatusCode,
            `Expected status code ${testCase.expectedStatusCode} but got ${res.statusCode}`,
          );

          if (testCase.expectedBody) {
            assert.deepStrictEqual(JSON.parse(data), testCase.expectedBody, `Expected body does not match`);
          }

          if (testCase.expectedBodyLength !== undefined) {
            assert.strictEqual(
              JSON.parse(data).length,
              testCase.expectedBodyLength,
              `Expected body length does not match`,
            );
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);

    if (testCase.requestData) {
      req.write(JSON.stringify(testCase.requestData));
    }

    req.end();
  });
}
