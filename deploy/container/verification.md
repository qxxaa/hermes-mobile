# Container pipeline verification

## Scope

The single-commit `feat/container-publishing` branch is based on upstream
`d35d93dbbb010ba72fb8183ee3377de2e27c6f33`. No renderer files or dependency
versions are changed by the container work. Earlier revisions were committed,
pushed and built in Actions, but failed the smoke harness before publication.
The current revision corrects the harness lifecycle and streaming assertions;
its Docker and registry result must be taken from its own Actions run.

## Directly executed checks

- `node --test tests/container/*.test.mjs`: 53 passed, zero failures.
  Covers release ordering, registry lookup, header case/order, non-followed
  redirects, bounded readiness, stale backend identity, complete incremental
  streams, HTTP errors, truncation, socket aborts, and shell lifecycle ordering.
  Shell lifecycle checks use an explicitly labelled Docker test double; HTTP
  client checks use real loopback servers. Neither substitutes for Docker CI.
- `sh tests/container/validate-gateway-url.test.sh`: passed.
- Shell syntax checks for the container scripts and 14 workflow run steps:
  passed. Workflow YAML parsing and main-only push policy assertions passed.
- Every pinned GitHub Action commit was resolved through the GitHub API.
- `git diff --check`: passed.
- Real local nginx check via `tests/container/check-local-proxy.mjs`: passed.
  It used an isolated extracted Debian nginx binary, not the Docker runtime.
  Verified static cache rules, missing files, SPA fallback, API bodies/query
  strings, cookies, authentication routes, redirect headers, forwarded protocol,
  protocol-valid WebSocket echo, unbuffered streaming, and recovery after a
  DNS record moved the backend to a different loopback IP. Trusted HTTPS
  succeeded and an untrusted certificate produced a 502.

The local proxy harness uses explicitly synthetic static content and an echo
backend. It does not claim to reproduce Hermes behavior or a production image.
The unchanged renderer suite was not repeated during the direct takeover.

## Dependency audit

The current lockfile reports two inherited findings:
- High: nanoid 3.3.17 nested under postcss, advisory GHSA-2v37-7h3g-55p8.
  Its dependency location is in the build toolchain.
- Moderate: sanitize-html 2.17.6 through @nous-research/ui 0.18.2,
  advisory GHSA-g8qq-57p8-ggw5. The UI utility bundle imports this dependency;
  exploitability in the shipped browser bundle has not been established.

These findings were not silently fixed or dismissed as part of packaging.
No clean vulnerability-scan claim is made; assess the remaining UI finding
before treating publication as production-ready.

## Remaining release evidence

- The image build passed in earlier Actions runs. The complete smoke test
  with the current lifecycle correction still requires its own runner result.
- GHCR authentication and publication with the workflow token.
- Read-back equality of the candidate and latest manifest digests.
- Two distinct successful publications remaining pullable by digest and a
  rollback deployment using the first digest.
- Real Hermes authentication, sessions, reconnect and desktop/phone checks.
- Package visibility selection if anonymous pulls are wanted.

The current workspace has no Docker daemon. A direct GHCR connection was also
rejected by the environment's outbound proxy. Neither condition is a PAT
permission diagnosis, and no network or credential settings were changed.
