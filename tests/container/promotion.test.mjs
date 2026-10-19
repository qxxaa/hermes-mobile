import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  classifyLatestManifestLookup,
  decideLatestPromotion,
  parseLatestRunNumber
} from '../../scripts/container/promotion.mjs'

test('promotes a candidate when latest is confirmed missing', () => {
  assert.deepEqual(decideLatestPromotion({ candidateRunNumber: 42, latest: { state: 'missing' } }), {
    promote: true,
    reason: 'latest-is-missing'
  })
})

test('promotes a candidate with a higher workflow run number', () => {
  assert.deepEqual(
    decideLatestPromotion({ candidateRunNumber: 42, latest: { state: 'found', runNumber: 41 } }),
    { promote: true, reason: 'candidate-is-newer' }
  )
})

test('does not let an older or equal rerun regress latest', () => {
  assert.deepEqual(
    decideLatestPromotion({ candidateRunNumber: 41, latest: { state: 'found', runNumber: 42 } }),
    { promote: false, reason: 'latest-is-newer' }
  )
  assert.deepEqual(
    decideLatestPromotion({ candidateRunNumber: 42, latest: { state: 'found', runNumber: 42 } }),
    { promote: false, reason: 'equal-run-number' }
  )
})

test('fails closed for malformed candidate ordering or an uninspectable latest', () => {
  assert.throws(
    () => decideLatestPromotion({ candidateRunNumber: 0, latest: { state: 'missing' } }),
    /positive integer/
  )
  assert.throws(
    () => decideLatestPromotion({ candidateRunNumber: 42, latest: { state: 'error' } }),
    /could not be inspected/
  )
})

test('parses only a positive integer run-number label', () => {
  assert.equal(parseLatestRunNumber('42'), 42)
  assert.equal(parseLatestRunNumber('0042'), 42)
  assert.equal(parseLatestRunNumber('0'), null)
  assert.equal(parseLatestRunNumber('42.5'), null)
  assert.equal(parseLatestRunNumber('not-a-number'), null)
})

test('classifies only the registry MANIFEST_UNKNOWN response as a missing latest tag', () => {
  assert.deepEqual(
    classifyLatestManifestLookup({
      httpStatus: 404,
      responseBody: JSON.stringify({ errors: [{ code: 'MANIFEST_UNKNOWN' }] })
    }),
    { state: 'missing' }
  )
  assert.deepEqual(
    classifyLatestManifestLookup({
      httpStatus: 200,
      responseBody: '{"schemaVersion":2}'
    }),
    { state: 'found' }
  )
  assert.deepEqual(
    classifyLatestManifestLookup({
      httpStatus: 401,
      responseBody: JSON.stringify({ errors: [{ code: 'UNAUTHORIZED' }] })
    }),
    { state: 'error', reason: 'HTTP 401' }
  )
  assert.deepEqual(
    classifyLatestManifestLookup({
      httpStatus: 404,
      responseBody: JSON.stringify({ errors: [{ code: 'NAME_UNKNOWN' }] })
    }),
    { state: 'error', reason: 'HTTP 404' }
  )
  assert.deepEqual(
    classifyLatestManifestLookup({ httpStatus: 404, responseBody: 'not found' }),
    { state: 'error', reason: 'HTTP 404' }
  )
})

test('CLI classifier only permits the explicit missing-manifest response', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hermes-mobile-promotion-'))
  const responsePath = join(directory, 'response.json')
  const classifier = 'scripts/container/classify-latest-manifest.mjs'
  try {
    writeFileSync(responsePath, JSON.stringify({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }))
    assert.equal(
      execFileSync(process.execPath, [classifier, '404', responsePath], { encoding: 'utf8' }).trim(),
      'missing'
    )

    writeFileSync(responsePath, JSON.stringify({ errors: [{ code: 'UNAUTHORIZED' }] }))
    assert.throws(
      () => execFileSync(process.execPath, [classifier, '401', responsePath], { encoding: 'utf8', stdio: 'pipe' }),
      /latest manifest lookup failed: HTTP 401/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
