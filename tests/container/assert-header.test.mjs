import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function check(input, name = 'Set-Cookie', value = 'fixture=yes; Path=/') {
  return spawnSync('sh', ['tests/container/assert-header.sh', name, value], { input, encoding: 'utf8' })
}

for (const name of ['Set-Cookie', 'set-cookie', 'sEt-CoOkIe']) {
  test(`accepts header-name case: ${name}`, () => {
    assert.equal(check(`  ${name}: fixture=yes; Path=/\r\n`).status, 0)
  })
}
test('accepts lowercase redirect header with tab spacing', () => {
  assert.equal(check('\tlocation:\t/api/echo?redirected=1\r\n', 'Location', '/api/echo?redirected=1').status, 0)
})
test('preserves case-sensitive header values', () => {
  const result = check('set-cookie: fixture=yes; path=/\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing expected header: Set-Cookie: fixture=yes; Path=\//)
})
test('reports missing headers', () => {
  const result = check('HTTP/1.1 200 OK\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing expected header: Set-Cookie/)
})
test('does not accept wget redirect commentary as a header value', () => {
  assert.equal(check('Location: /api/echo?redirected=1 [following]\n', 'Location', '/api/echo?redirected=1').status, 1)
})
