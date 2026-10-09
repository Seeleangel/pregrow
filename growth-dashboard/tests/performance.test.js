const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { performanceMiddleware } = require('../backend/middlewares/performance');

test('performance monitoring preserves a streamed response', async (t) => {
  const app = express();
  app.use(performanceMiddleware);
  app.get('/stream', (_req, res) => {
    res.write('first');
    res.end('second');
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/stream`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'firstsecond');
});
