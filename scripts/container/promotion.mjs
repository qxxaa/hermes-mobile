function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}

export function parseLatestRunNumber(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function classifyLatestManifestLookup({ httpStatus, responseBody }) {
  if (httpStatus >= 200 && httpStatus < 300) return { state: 'found' }

  let errorCode = null
  try {
    const response = JSON.parse(responseBody)
    errorCode = response?.errors?.[0]?.code
  } catch {
    // A non-JSON error cannot prove that the latest manifest is absent.
  }

  if (httpStatus === 404 && errorCode === 'MANIFEST_UNKNOWN') return { state: 'missing' }
  return { state: 'error', reason: `HTTP ${httpStatus}` }
}

export function decideLatestPromotion({ candidateRunNumber, latest }) {
  requirePositiveInteger(candidateRunNumber, 'candidateRunNumber')

  if (!latest || latest.state === 'error') {
    throw new Error('currently published latest could not be inspected')
  }
  if (latest.state === 'missing') return { promote: true, reason: 'latest-is-missing' }
  if (latest.state !== 'found') throw new Error(`unsupported latest inspection state: ${latest.state}`)

  requirePositiveInteger(latest.runNumber, 'latest.runNumber')
  if (candidateRunNumber > latest.runNumber) return { promote: true, reason: 'candidate-is-newer' }
  if (candidateRunNumber === latest.runNumber) return { promote: false, reason: 'equal-run-number' }
  return { promote: false, reason: 'latest-is-newer' }
}
