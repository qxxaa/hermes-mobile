import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupLatest } from '../../scripts/container/lookup-latest.mjs'

const image = 'ghcr.io/qxxaa/hermes-mobile'
const manifest = { schemaVersion: 2, config: { digest: `sha256:${'a'.repeat(64)}` }, layers: [] }
const challenge = 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:qxxaa/hermes-mobile:pull"'
const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers })

function sequence(replies) {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options })
    const next = replies.shift()
    if (next instanceof Error) throw next
    assert.ok(next, 'unexpected network call')
    return next
  }
  return { calls, fetchFn }
}

test('public manifest needs no credential exchange', async () => {
  const net = sequence([response(200, manifest)])
  assert.equal(await lookupLatest({ image, fetchFn: net.fetchFn }), 'found')
  assert.equal(net.calls[0].options.headers.Authorization, undefined)
})

test('private lookup exchanges Basic credentials for scoped Bearer token', async () => {
  const net = sequence([
    response(401, {}, { 'WWW-Authenticate': challenge }),
    response(200, { token: 'fixture-bearer' }),
    response(200, manifest)
  ])
  assert.equal(await lookupLatest({ image, actor: 'fixture-user', token: 'fixture-secret', fetchFn: net.fetchFn }), 'found')
  const tokenUrl = new URL(net.calls[1].url)
  assert.equal(tokenUrl.origin, 'https://ghcr.io')
  assert.equal(tokenUrl.pathname, '/token')
  assert.equal(tokenUrl.searchParams.get('scope'), 'repository:qxxaa/hermes-mobile:pull')
  assert.equal(net.calls[1].options.headers.Authorization, `Basic ${Buffer.from('fixture-user:fixture-secret').toString('base64')}`)
  assert.equal(net.calls[2].options.headers.Authorization, 'Bearer fixture-bearer')
  assert.ok(net.calls.every(call => call.options.redirect === 'error'))
})

test('only explicit missing manifest is accepted as first publication', async () => {
  const net = sequence([response(404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] })])
  assert.equal(await lookupLatest({ image, fetchFn: net.fetchFn }), 'missing')
})

for (const [name, reply] of [
  ['forbidden', response(403, {})],
  ['unknown repository', response(404, { errors: [{ code: 'NAME_UNKNOWN' }] })],
  ['bad gateway', response(502, {})],
  ['malformed success', response(200, {})],
  ['network failure', new Error('fixture network failure')]
]) {
  test(`fails closed on ${name}`, async () => {
    const net = sequence([reply])
    await assert.rejects(lookupLatest({ image, fetchFn: net.fetchFn }))
  })
}

for (const badChallenge of [challenge.replace('https://ghcr.io/token', 'https://untrusted.invalid/token'), 'Basic realm="registry"']) {
  test(`rejects unsafe challenge ${badChallenge}`, async () => {
    const net = sequence([response(401, {}, { 'WWW-Authenticate': badChallenge })])
    await assert.rejects(lookupLatest({ image, actor: 'fixture', token: 'fixture', fetchFn: net.fetchFn }))
    assert.equal(net.calls.length, 1)
  })
}

for (const tokenReply of [response(401, {}), response(200, {}), response(200, { token: 'bad\nheader' })]) {
  test(`fails closed on token exchange ${tokenReply.status}`, async () => {
    const net = sequence([response(401, {}, { 'WWW-Authenticate': challenge }), tokenReply])
    await assert.rejects(lookupLatest({ image, actor: 'fixture', token: 'fixture', fetchFn: net.fetchFn }))
    assert.equal(net.calls.length, 2)
  })
}

test('rejects wrong registry before using credentials', async () => {
  await assert.rejects(lookupLatest({ image: 'untrusted.invalid/image', fetchFn: () => assert.fail('must not fetch') }))
})
