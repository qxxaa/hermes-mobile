import assert from 'node:assert/strict'
import { get } from 'node:http'

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 80)

try {
  // http.get does not follow redirects and exposes the complete header block.
  await new Promise((resolve, reject) => {
    const request = get({ hostname: host, port, path: '/api/redirect', signal: AbortSignal.timeout(10_000) }, response => {
      response.on('error', reject)
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 302, 'expected redirect status 302')
          assert.equal(response.headers.location, '/api/echo?redirected=1', 'unexpected redirect location')
          assert.deepEqual(response.headers['set-cookie'], ['fixture=yes; Path=/'], 'unexpected redirect cookie')
          resolve()
        } catch (error) { reject(error) }
      })
      response.resume()
    })
    request.on('error', reject)
  })
  console.log('redirect status, location and cookie passed without following redirect')
} catch (error) {
  console.error(`redirect check failed: ${error.message}`)
  process.exitCode = 1
}
