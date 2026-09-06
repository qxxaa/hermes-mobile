// Contract tests for shell orchestration using an explicit Docker test double.
// These are not Docker execution or image-publication evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'

const double = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args=process.argv.slice(2);
const prior=readFileSync(process.env.CALLS,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
appendFileSync(process.env.CALLS,JSON.stringify(args)+'\\n');
const output=s=>process.stdout.write(s+'\\n');
const error=s=>{console.error(s);process.exit(1)};
if(args.includes('--ip'))error('static IP requires a user configured subnet');
if(args[0]==='image'){
 const field=args.join(' ');
 output(field.includes('source')?'https://github.com/qxxaa/hermes-mobile':field.includes('revision')?'a'.repeat(40):'main');
}else if(args[0]==='inspect'){
 const name=args.at(-1);
 if(args.join(' ').includes('IPAddress'))output(name.includes('replacement')?'172.20.0.4':'172.20.0.2');
 else output(process.env.FAILURE==='restart' && prior.some(a=>a[0]==='rm' && a.some(v=>v.startsWith('hermes-mobile-backend-')))?'restarted':'unchanged');
}else if(args[0]==='run'){
 const name=args.includes('--name')?args[args.indexOf('--name')+1]:'';
 if(name.endsWith('-invalid'))error(args.includes('-e')?'invalid HERMES_GATEWAY_URL: must start with http:// or https://':'invalid HERMES_GATEWAY_URL: it is required');
 if(name.startsWith('hermes-mobile-replacement-')){
  if(prior.some(a=>a[0]==='rm'&&a.some(v=>v.startsWith('hermes-mobile-backend-'))))error('old backend released address before replacement allocation');
 }
 if(args.includes('/fixture-ready-client.mjs') && process.env.FAILURE==='readiness')error('readiness deliberately failed');
 if(args.includes('/fixture-stream-client.mjs') && process.env.FAILURE==='stream')error('stream deliberately failed');
 output('fixture success');
}else if(args[0]==='exec'){
 const url=args.at(-1);
 if(url.endsWith('/build-info.json')&&args.includes('-qO-'))output('{"commit": "'+'a'.repeat(40)+'", "source": "ci"}');
 else if(url.endsWith('/api/echo'))output('{"instance":"replaced"}');
 else if(url.includes('/api/echo?'))output('{"query":"?query=kept","body":"body=kept","forwardedProto":"http","cookie":"session=kept"}');
 else if(url.includes('does-not-exist'))output('404 Not Found');
 else if(url.endsWith('/assets/app.js'))output('200 OK\\nCache-Control: public, max-age=31536000, immutable');
 else if(url.endsWith('/sw.js')||url.endsWith('/build-info.json'))output('200 OK\\nCache-Control: no-cache');
 else output('<script src="./assets/app.js"></script>');
}else if(args[0]==='logs')output('fixture diagnostic log');
`;

function run(failure = '') {
  const directory = mkdtempSync(join(tmpdir(), 'smoke-contract-'))
  try {
    const callsPath = join(directory, 'calls.jsonl')
    writeFileSync(callsPath, '')
    writeFileSync(join(directory, 'docker'), double, { mode: 0o755 })
    const result = spawnSync('sh', ['tests/container/run-smoke.sh', 'fixture-image'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${directory}:${dirname(process.execPath)}:${process.env.PATH}`, CALLS: callsPath, FAILURE: failure, GITHUB_REPOSITORY: 'qxxaa/hermes-mobile', GITHUB_SHA: 'a'.repeat(40) }
    })
    const calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    return { ...result, calls }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('shell replaces backend while its old address is occupied and checks identity without restarting frontend', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const calls = result.calls
  assert.ok(!calls.some(a => a.includes('--ip')))
  const allocation = calls.findIndex(a => a[0] === 'run' && a.some(v => v.startsWith('hermes-mobile-replacement-')))
  const removal = calls.findIndex(a => a[0] === 'rm' && a.some(v => v.startsWith('hermes-mobile-backend-')))
  assert.ok(allocation >= 0 && allocation < removal)
  const polls = calls.filter(a => a.includes('/fixture-ready-client.mjs'))
  assert.equal(polls.length, 4, 'both backends and both frontend identities must be polled')
  assert.equal(polls.at(-1).at(-1), 'replaced')
  assert.ok(calls.filter(a => a[0] === 'inspect' && a.join(' ').includes('StartedAt')).length >= 2)
  assert.match(result.stdout, /container smoke test passed/)
})

for (const failure of ['readiness', 'stream', 'restart']) {
  test(`shell reports stage, captures diagnostics before cleanup and preserves failure: ${failure}`, () => {
    const result = run(failure)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /smoke test failed at stage:/)
    const logIndex = result.calls.findIndex(a => a[0] === 'logs')
    const cleanupIndex = result.calls.findLastIndex(a => a[0] === 'rm')
    assert.ok(logIndex >= 0 && cleanupIndex > logIndex, 'diagnostics must precede cleanup')
    assert.ok(result.calls.some(a => a[0] === 'network' && a[1] === 'rm'))
    assert.doesNotMatch(result.stdout, /container smoke test passed/)
  })
}
