import { pathToFileURL } from 'node:url'
import { classifyLatestManifestLookup } from './promotion.mjs'

const accept = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json'
].join(', ')

// Distribution v2 token exchange, restricted to GHCR. Never forward credentials
// to a challenge-selected host or follow redirects with authorization attached.
export async function lookupLatest({ image, actor, token, fetchFn = fetch }) {
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(image || '')) {
    throw new Error('expected ghcr.io/owner/repository image')
  }
  const repository = image.slice('ghcr.io/'.length)
  const url = `https://ghcr.io/v2/${repository}/manifests/latest`
  const request = (url, headers) => fetchFn(url, {
    headers, redirect: 'error', signal: AbortSignal.timeout(15_000)
  })
  let result = await request(url, { Accept: accept })
  if (result.status === 401) {
    const challenge = result.headers.get('www-authenticate') || ''
    const fields = Object.fromEntries([...challenge.matchAll(/([a-z_]+)="([^"]*)"/gi)].map(match => [match[1].toLowerCase(), match[2]]))
    if (!/^Bearer\s/i.test(challenge) || fields.realm !== 'https://ghcr.io/token' || fields.service !== 'ghcr.io') {
      throw new Error('unrecognized GHCR authorization challenge')
    }
    const tokenUrl = new URL('https://ghcr.io/token')
    tokenUrl.searchParams.set('service', 'ghcr.io')
    tokenUrl.searchParams.set('scope', `repository:${repository}:pull`)
    const headers = {}
    if (token || actor) {
      if (!token || !actor || actor.includes(':')) throw new Error('both registry actor and token are required')
      headers.Authorization = `Basic ${Buffer.from(`${actor}:${token}`).toString('base64')}`
    }
    const tokenResult = await request(tokenUrl, headers)
    if (!tokenResult.ok) throw new Error(`registry token exchange failed: HTTP ${tokenResult.status}`)
    let data
    try { data = await tokenResult.json() } catch { throw new Error('invalid registry token response') }
    const bearer = data.token || data.access_token
    if (typeof bearer !== 'string' || !/^[A-Za-z0-9._~+/=-]+$/.test(bearer)) throw new Error('invalid registry bearer token')
    result = await request(url, { Accept: accept, Authorization: `Bearer ${bearer}` })
  }
  const body = await result.text()
  const state = classifyLatestManifestLookup({ httpStatus: result.status, responseBody: body })
  if (state.state === 'error') throw new Error(`latest lookup failed: ${state.reason}`)
  if (state.state === 'found') {
    let manifest
    try { manifest = JSON.parse(body) } catch { throw new Error('invalid registry manifest response') }
    if (manifest.schemaVersion !== 2 || !(Array.isArray(manifest.manifests) || (manifest.config?.digest && Array.isArray(manifest.layers)))) {
      throw new Error('invalid registry manifest response')
    }
  }
  return state.state
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await lookupLatest({ image: process.env.IMAGE, actor: process.env.GITHUB_ACTOR, token: process.env.GHCR_TOKEN }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
