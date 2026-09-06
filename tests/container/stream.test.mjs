import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'

async function probe(handler) {
  const timers = []
  const server = createServer((req, res) => handler(res, (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timers.push(timer)
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const child = spawn(process.execPath, ['tests/container/fixture-stream-client.mjs', '127.0.0.1', String(server.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const [code] = await once(child, 'exit')
    return { code, output }
  } finally {
    timers.forEach(clearTimeout)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

test('accepts complete incremental delivery across split chunks', async () => {
  const result = await probe((res, later) => {
    res.writeHead(200)
    res.write('fir')
    later(() => res.write('st\n'), 30)
    later(() => res.end('second\n'), 1500)
  })
  assert.equal(result.code, 0, result.output)
})

for (const [name, handler] of [
  ['HTTP 500', (res, later) => { res.writeHead(500); res.write('first\n'); later(() => res.end('second\n'), 1500) }],
  ['missing second chunk', (res, later) => { res.write('first\n'); later(() => res.end(), 1500) }],
  ['buffered full response', (res, later) => { later(() => res.end('first\nsecond\n'), 1500) }],
  ['premature socket close', (res, later) => { res.write('first\n'); later(() => res.destroy(), 50) }],
  ['never-ending response', res => { res.write('first\n') }],
  ['extra body content', (res, later) => { res.write('first\n'); later(() => res.end('second\nextra'), 1500) }]
]) {
  test(`rejects ${name}`, { timeout: 8000 }, async () => {
    const result = await probe(handler)
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /stream check failed/)
  })
}
