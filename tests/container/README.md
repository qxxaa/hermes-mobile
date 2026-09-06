# Container fixture tests

Run helper and release-policy tests with `node --test tests/container/*.test.mjs`.
Run URL validation with `sh tests/container/validate-gateway-url.test.sh`.

For an existing local nginx binary, use `NGINX_BINARY=/path/to/nginx node tests/container/check-local-proxy.mjs`.
This creates isolated loopback listeners, temporary nginx configuration and
self-signed test certificates. It tests the real template, including TLS trust
and resolver recovery; it does not install nginx or test the container image.

`run-smoke.sh` is a Docker-backed transport fixture for the published nginx image. It runs a small purpose-built HTTP and WebSocket echo backend, then verifies the browser-facing proxy leg: redirects and cookies, query strings and request bodies, forwarding headers, WebSocket upgrade/echo, streamed responses, SPA deep links, static cache headers, missing assets, and backend DNS replacement.

Readiness polls the original backend, the proxy, the replacement backend and
then the proxy's replacement identity, each with a total deadline. The new
backend is allocated while the original still owns its address, so no explicit
IP or subnet is needed. The test checks that the frontend container ID, start
time and restart count did not change. Failure output identifies the stage and
captures fixture logs and network state before cleanup.

Streaming requires HTTP 200, the exact complete two-line body and a measurable
gap between the first line and completion. Redirects are inspected without
following them. All probe containers are named and cleaned up on failure.

`smoke-lifecycle.test.mjs` exercises the shell against a deliberate Docker test
double, including failure and cleanup ordering. It is not a replacement for
the Docker-backed smoke run. The HTTP client tests use real loopback servers.

The fixture is not a Hermes Agent substitute and does not claim gateway compatibility. It proves nginx transport behavior only. Run it on a Docker-capable linux/amd64 host after building or loading the candidate image:

```sh
tests/container/run-smoke.sh ghcr.io/qxxaa/hermes-mobile:candidate
```
