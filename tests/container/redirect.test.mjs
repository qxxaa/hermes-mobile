import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'

async function probe(headers, status = 302) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(status, headers)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const child = spawn(process.execPath, ['tests/container/fixture-redirect-client.mjs', '127.0.0.1', String(server.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const [code] = await once(child, 'exit')
    return { code, output, requests }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

for (const names of [['Location', 'Set-Cookie'], ['location', 'set-cookie']]) {
  for (const reverse of [false, true]) {
    test(`reads complete redirect: ${names.join(',')} reverse=${reverse}`, async () => {
      const pairs = [[names[0], '/api/echo?redirected=1'], [names[1], 'fixture=yes; Path=/']]
      if (reverse) pairs.reverse()
      const result = await probe(pairs.flat())
      assert.equal(result.code, 0, result.output)
      assert.deepEqual(result.requests, ['/api/redirect'], 'must not follow redirect')
    })
  }
}
for (const [name, headers, status] of [
  ['missing cookie', { location: '/api/echo?redirected=1' }, 302],
  ['wrong cookie case', { location: '/api/echo?redirected=1', 'set-cookie': 'fixture=yes; path=/' }, 302],
  ['wrong location', { location: '/wrong', 'set-cookie': 'fixture=yes; Path=/' }, 302],
  ['wrong status', { location: '/api/echo?redirected=1', 'set-cookie': 'fixture=yes; Path=/' }, 200]
]) {
  test(`rejects ${name}`, async () => {
    const result = await probe(headers, status)
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /redirect check failed/)
  })
}
