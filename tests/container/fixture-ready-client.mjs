import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

export async function waitForInstance({ host, port, expected, timeoutMs = 45000, requestTimeoutMs = 1500, intervalMs = 500 }) {
  assert.ok(host && Number.isInteger(port) && port > 0 && port <= 65535 && expected, 'expected HOST PORT INSTANCE')
  const deadline = performance.now() + timeoutMs
  let lastError = 'no response'
  while (performance.now() < deadline) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()))
    try {
      const response = await fetch(`http://${host}:${port}/api/echo`, {
        redirect: 'error', signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remaining))
      })
      // Keep body consumption under the same per-request deadline.
      const text = await response.text()
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const data = JSON.parse(text)
      if (data.instance !== expected) throw new Error(`received instance ${JSON.stringify(data.instance)}`)
      return
    } catch (error) {
      lastError = error.message
    }
    const pause = Math.min(intervalMs, deadline - performance.now())
    if (pause > 0) await delay(pause)
  }
  throw new Error(`${host}:${port} did not reach instance ${expected} within ${timeoutMs}ms: ${lastError}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [host, port, expected] = process.argv.slice(2)
    await waitForInstance({ host, port: Number(port), expected })
    console.log(`${host}:${port} ready with instance ${expected}`)
  } catch (error) {
    console.error(`readiness check failed: ${error.message}`)
    process.exitCode = 1
  }
}
