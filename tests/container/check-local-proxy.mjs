// Optional real-nginx check without Docker. Temporary ports, config and test
// certificates only. Does not claim to validate the container image or registry.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { createServer as createTlsServer } from 'node:https'
import { createServer as createTcpServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const binary = process.env.NGINX_BINARY
assert.ok(binary, 'NGINX_BINARY must point to an existing nginx executable')
const root = process.cwd()
const work = mkdtempSync(join(process.env.TEST_TMPDIR || '/tmp', 'mobile-proxy-'))
const children = []
const servers = []
let dns
let dnsIp = '127.0.0.1'
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', ...options })
async function freePort() {
  const server = createTcpServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
function start(file, args, env = {}) {
  const child = spawn(file, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.output = ''
  child.stdout.on('data', data => { child.output += data })
  child.stderr.on('data', data => { child.output += data })
  children.push(child)
  return child
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}
async function ready(url, child, expectedStatus = 200) {
  for (let i = 0; i < 60; i++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(child.output)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      await response.arrayBuffer()
      if (response.status === expectedStatus) return
    } catch {}
    await delay(50)
  }
  throw new Error(`listener not ready: ${url}; ${child?.output || ''}`)
}

try {
  // Minimal A-only DNS fixture, allowing a real resolver-cache/IP replacement check.
  dns = createSocket('udp4')
  dns.on('message', (question, peer) => {
    let end = 12
    while (question[end]) end += question[end] + 1
    end += 5
    const header = Buffer.from(question.subarray(0, 12))
    header.writeUInt16BE(0x8180, 2)
    header.writeUInt16BE(1, 6); header.writeUInt16BE(0, 8); header.writeUInt16BE(0, 10)
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...dnsIp.split('.').map(Number)])
    dns.send(Buffer.concat([header, question.subarray(12, end), answer]), peer.port, peer.address)
  })
  dns.bind(0, '127.0.0.1'); await once(dns, 'listening')
  const dnsPort = dns.address().port
  const backendPort = await freePort()
  let backend = start(process.execPath, ['tests/container/fixture-backend.mjs'], { HOST: dnsIp, PORT: String(backendPort) })
  await ready(`http://${dnsIp}:${backendPort}/api/echo`, backend)

  // Synthetic static assets exercise cache/routing; no fabricated app-build claim.
  const html = join(work, 'html'); mkdirSync(join(html, 'assets'), { recursive: true })
  writeFileSync(join(html, 'index.html'), '<html>transport fixture</html>')
  writeFileSync(join(html, 'assets/app-abc123.js'), '// fixture hashed asset')
  writeFileSync(join(html, 'sw.js'), '// fixture service worker')
  writeFileSync(join(html, 'manifest.json'), '{}')

  async function proxy(name, gateway, ca = '/etc/ssl/certs/ca-certificates.crt') {
    const directory = join(work, name); mkdirSync(directory)
    run('sh', ['deploy/container/15-validate-gateway.sh'], { env: { ...process.env, HERMES_GATEWAY_URL: gateway, HERMES_NGINX_CONF_DIR: directory } })
    const port = await freePort()
    const template = readFileSync('deploy/container/default.conf.template', 'utf8')
      .replace('listen 80;', `listen 127.0.0.1:${port};`)
      .replace('listen [::]:80;', '')
      .replace('/usr/share/nginx/html', html)
      .replace('127.0.0.11 valid=10s', `127.0.0.1:${dnsPort} valid=1s`)
      .replace('/etc/ssl/cert.pem', ca)
    const config = join(directory, 'nginx.conf')
    writeFileSync(config, `daemon off;\nmaster_process off;\npid ${directory}/pid;\nerror_log ${directory}/error.log;\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path ${directory}/body;\nproxy_temp_path ${directory}/proxy;\nfastcgi_temp_path ${directory}/fastcgi;\nuwsgi_temp_path ${directory}/uwsgi;\nscgi_temp_path ${directory}/scgi;\ninclude ${directory}/10-hermes-gateway-upstream.conf;\n${template}\n}\n`)
    run(binary, ['-t', '-p', directory + '/', '-c', config])
    const child = start(binary, ['-p', directory + '/', '-c', config])
    const origin = `http://127.0.0.1:${port}`
    await ready(origin, child)
    return { origin, port, child }
  }
  const frontend = await proxy('http', `http://gateway.test:${backendPort}`)
  let response = await fetch(frontend.origin + '/a/deep/link')
  assert.equal(await response.text(), '<html>transport fixture</html>')
  for (const [path, cache, status] of [
    ['/assets/app-abc123.js', 'immutable', 200], ['/assets/missing.js', null, 404],
    ['/sw.js', 'no-cache', 200], ['/manifest.json', 'no-cache', 200], ['/missing.js', null, 404]
  ]) {
    response = await fetch(frontend.origin + path)
    assert.equal(response.status, status)
    if (cache) assert.ok(response.headers.get('cache-control').includes(cache))
    await response.arrayBuffer()
  }
  response = await fetch(frontend.origin + '/api/echo?query=kept', {
    method: 'POST', body: 'body=kept', headers: { Cookie: 'session=kept', 'X-Forwarded-Proto': 'https' }
  })
  const echo = await response.json()
  assert.equal(echo.body, 'body=kept'); assert.equal(echo.query, '?query=kept')
  assert.equal(echo.cookie, 'session=kept'); assert.equal(echo.forwardedProto, 'https')
  response = await fetch(frontend.origin + '/api/redirect', { redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/api/echo?redirected=1')
  assert.equal(response.headers.get('set-cookie'), 'fixture=yes; Path=/')
  for (const route of ['/auth/password-login', '/login', '/fonts/example.woff2']) {
    response = await fetch(frontend.origin + route)
    assert.equal((await response.json()).path, route)
  }
  // Asynchronous child execution lets this process continue answering DNS.
  for (const script of ['fixture-websocket-client.mjs', 'fixture-redirect-client.mjs', 'fixture-stream-client.mjs']) {
    const child = start(process.execPath, [`tests/container/${script}`, '127.0.0.1', String(frontend.port)])
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, child.output)
    console.log(child.output.trim())
  }
  await stop(backend)
  dnsIp = '127.0.0.2'
  backend = start(process.execPath, ['tests/container/fixture-backend.mjs'], { HOST: dnsIp, PORT: String(backendPort), INSTANCE: 'replaced' })
  await ready(`http://${dnsIp}:${backendPort}/api/echo`, backend)
  await delay(2100)
  response = await fetch(frontend.origin + '/api/echo')
  assert.equal((await response.json()).instance, 'replaced')
  console.log('HTTP, auth routes, cookies, cache, headers and changed-IP DNS recovery passed')

  const key = join(work, 'key.pem'), cert = join(work, 'cert.pem')
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=gateway.test', '-addext', 'subjectAltName=DNS:gateway.test'])
  const tls = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => res.end('verified TLS'))
  servers.push(tls); tls.listen(0, dnsIp); await once(tls, 'listening')
  const gateway = `https://gateway.test:${tls.address().port}`
  const trusted = await proxy('trusted-tls', gateway, cert)
  response = await fetch(trusted.origin + '/api/echo')
  assert.equal(response.status, 200); assert.equal(await response.text(), 'verified TLS')
  const untrusted = await proxy('untrusted-tls', gateway)
  response = await fetch(untrusted.origin + '/api/echo')
  assert.equal(response.status, 502); await response.arrayBuffer()
  console.log('Trusted HTTPS accepted; untrusted certificate rejected')
  console.log('Local nginx transport checks passed (not a Docker image test)')
} finally {
  await Promise.all(children.map(stop))
  for (const server of servers) server.close()
  dns?.close()
  if (process.env.KEEP_TEST_OUTPUT) console.log('Test files retained:', work)
  else rmSync(work, { recursive: true, force: true })
}
