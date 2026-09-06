import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { waitForInstance } from './fixture-ready-client.mjs'

async function withServer(handler, check) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await check({ host: '127.0.0.1', port: server.address().port, expected: 'replaced', timeoutMs: 350, requestTimeoutMs: 60, intervalMs: 10 })
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

test('readiness retries errors and stale identity until the expected backend is ready', async () => {
  let calls = 0
  await withServer((_req, res) => {
    calls++
    if (calls === 1) { res.writeHead(502); res.end('not ready') }
    else res.end(JSON.stringify({ instance: calls === 2 ? 'first' : 'replaced' }))
  }, async options => {
    await waitForInstance(options)
    assert.equal(calls, 3)
  })
})

for (const [name, handler] of [
  ['wrong identity', (_req, res) => res.end('{"instance":"first"}')],
  ['malformed body', (_req, res) => res.end('<html>static page is not readiness</html>')],
  ['HTTP error', (_req, res) => { res.writeHead(500); res.end('{"instance":"replaced"}') }],
  ['stalled headers', () => {}],
  ['stalled body', (_req, res) => { res.writeHead(200); res.write('{') }]
]) {
  test(`readiness has a total deadline for ${name}`, { timeout: 2000 }, async () => {
    await withServer(handler, async options => {
      await assert.rejects(waitForInstance(options), /did not reach instance replaced/)
    })
  })
}
