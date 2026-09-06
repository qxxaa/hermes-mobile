import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.PORT || 9119)
const instance = process.env.INSTANCE || 'first'

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  if (url.pathname === '/api/stream') {
    response.writeHead(200, { 'content-type': 'text/plain', 'x-fixture-instance': instance })
    response.write('first\n')
    setTimeout(() => response.end('second\n'), 1_500)
    return
  }
  if (url.pathname === '/api/redirect') {
    response.writeHead(302, { location: '/api/echo?redirected=1', 'set-cookie': 'fixture=yes; Path=/' })
    response.end()
    return
  }
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString()
    response.writeHead(200, { 'content-type': 'application/json', 'x-fixture-instance': instance })
    response.end(JSON.stringify({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body,
      cookie: request.headers.cookie || '',
      forwardedProto: request.headers['x-forwarded-proto'] || '',
      forwardedHost: request.headers['x-forwarded-host'] || '',
      instance
    }))
  })
})

function writeFrame(socket, opcode, payload) {
  if (payload.length > 125) throw new Error('fixture supports only small WebSocket frames')
  socket.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]))
}

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']
  if (!key) return socket.destroy()
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.on('error', () => {})

  let pending = Buffer.alloc(0)
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 2) {
      const opcode = pending[0] & 0x0f
      const payloadLength = pending[1] & 0x7f
      const masked = (pending[1] & 0x80) !== 0
      if (!masked || payloadLength > 125) return socket.destroy()
      const frameLength = 2 + 4 + payloadLength
      if (pending.length < frameLength) return

      const mask = pending.subarray(2, 6)
      const payload = Buffer.from(pending.subarray(6, frameLength).map((byte, index) => byte ^ mask[index % mask.length]))
      pending = pending.subarray(frameLength)

      if (opcode === 0x1) writeFrame(socket, 0x1, payload)
      else if (opcode === 0x8) {
        writeFrame(socket, 0x8, payload)
        socket.end()
        return
      } else socket.destroy()
    }
  })
})

server.listen(port, process.env.HOST || '0.0.0.0')
