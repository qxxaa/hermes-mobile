import assert from 'node:assert/strict'

const [host, portText] = process.argv.slice(2)
const port = Number(portText)
if (!host || !Number.isInteger(port)) throw new Error('usage: fixture-websocket-client.mjs HOST PORT')

let receivedEcho = false
await new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://${host}:${port}/api/ws`)
  const timeout = setTimeout(() => {
    socket.close()
    reject(new Error('websocket echo fixture timed out'))
  }, 5_000)

  socket.addEventListener('open', () => socket.send('echo'))
  socket.addEventListener('message', event => {
    try {
      assert.equal(event.data, 'echo', 'server must echo the unmasked message payload')
      receivedEcho = true
      socket.close()
    } catch (error) {
      socket.close()
      reject(error)
    }
  })
  socket.addEventListener('error', () => reject(new Error('websocket connection failed')))
  socket.addEventListener('close', () => {
    clearTimeout(timeout)
    if (!receivedEcho) reject(new Error('websocket closed before echoing the message'))
    else resolve()
  })
})

console.log('websocket data was echoed with a protocol-valid frame')
