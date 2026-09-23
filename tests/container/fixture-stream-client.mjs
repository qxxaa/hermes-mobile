import assert from 'node:assert/strict'
import http from 'node:http'
import { performance } from 'node:perf_hooks'

try {
  const [host, portText] = process.argv.slice(2)
  const port = Number(portText)
  assert.ok(host && Number.isInteger(port) && port > 0 && port <= 65535, 'expected HOST PORT')
  const expected = 'first\nsecond\n'
  let firstChunkAt = null
  let body = ''
  const completedAt = await new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: '/api/stream', signal: AbortSignal.timeout(5000) }, response => {
      response.setEncoding('utf8')
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('stream response aborted')))
      if (response.statusCode !== 200) {
        request.destroy(new Error(`expected HTTP 200, received ${response.statusCode}`))
        return
      }
      response.on('data', chunk => {
        body += chunk
        if (!expected.startsWith(body)) {
          request.destroy(new Error('unexpected stream body'))
          return
        }
        if (firstChunkAt === null && body.startsWith('first\n')) firstChunkAt = performance.now()
      })
      response.on('end', () => resolve(performance.now()))
    })
    request.on('error', reject)
  })
  assert.equal(body, expected, 'incomplete stream body')
  assert.notEqual(firstChunkAt, null, 'first stream line was not received')
  assert.ok(completedAt - firstChunkAt >= 1000, 'stream was buffered instead of delivered incrementally')
  console.log('HTTP 200, complete stream and incremental delivery passed')
} catch (error) {
  console.error(`stream check failed: ${error.message}`)
  process.exitCode = 1
}
