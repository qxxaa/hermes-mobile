# Hermes Mobile container image

The image is a frontend-only nginx container. It serves the built PWA on port
80 and proxies the same-origin gateway routes `/api`, `/auth`, `/login`, and
`/fonts` to the separately managed Hermes gateway. It does not contain Hermes
Agent, a gateway, Node, build tools, configuration secrets, or persistent
volumes.

## Runtime configuration

`HERMES_GATEWAY_URL` is required. It must be an `http://` or `https://` origin
using a DNS name or IPv4 address, with an optional valid port and optional
trailing slash. Credentials, path prefixes, query strings, fragments,
whitespace, and nginx metacharacters are rejected at startup. There is no
fallback backend.

The nginx official entrypoint processes `default.conf.template`. Its hook
scripts execute in separate processes, so the validator writes a narrowly
scoped, validated `map` include rather than relying on nonpersistent shell
exports. `proxy_pass` uses those variables with Docker DNS `127.0.0.11`, which
allows addresses to be re-resolved after backend recreation. HTTPS upstreams
use the configured host for SNI and verify certificates against nginx Alpine's
runtime CA bundle at `/etc/ssl/cert.pem`.

Direct HTTP access works on a private network. For browser PWA features, put
TLS termination in front of this container. That trusted ingress must preserve
Host and overwrite X-Forwarded-Proto with exactly http or https. The container
passes those two values through; absent or other values fall back to its own
scheme. When using an ingress, restrict this inner listener to it rather than
accepting untrusted forwarded headers from public clients. Browser cookies and
redirects are preserved; gateway authentication remains with the gateway.

## Build and release

The Dockerfile accepts `SOURCE_REVISION` (required 40-character lowercase
hexadecimal revision) and `SOURCE_BRANCH` (default `main`). The build passes
both values to the existing build-stamp script as `GITHUB_SHA` and
`GITHUB_REF_NAME`; OCI labels record the source repository, source revision,
and branch. The generated stamp is also served at `/build-info.json` with
revalidation rather than immutable caching. The build stage uses the committed npm lockfile, Node 26, and npm
11.17.0. The runtime stage contains only nginx, the static assets, and nginx
runtime dependencies.

The GitHub Actions workflow validates pull requests without publishing. Every
push to `main` validates and builds its exact event SHA, loads and smoke-tests
the candidate image, then pushes that same image under an immutable UTC,
revision, run-ID, and attempt tag. A serialized follow-up job advances `latest`
only when its run number exceeds the current `latest` image label. Equal-run
reruns retain the existing `latest`. The workflow does not change package
visibility, use package credentials other than `GITHUB_TOKEN`, expire images,
or schedule automatic work.

Run the Docker-backed transport fixture on a linux/amd64 Docker host:

```sh
tests/container/run-smoke.sh ghcr.io/qxxaa/hermes-mobile:candidate
```

The fixture proves proxy transport only, not full Hermes Agent behavior.
`tests/container/check-local-proxy.mjs` additionally runs the template against
a supplied local nginx binary, covering trusted and untrusted HTTPS backends.
That check passed locally, including changed-IP DNS recovery and real streaming
and WebSocket traffic. It is not a substitute for testing the actual image.
Docker-backed execution, registry publication, dual-digest rollback, and real
Hermes/phone deployment remain release gates.

A standalone example is in `deploy/compose.example.yaml`. It expects a
preexisting Docker network and a separately managed gateway. It demonstrates
replacing the test frontend with backend `hermes-agent-test` on network
`genesis` and host port `8791`; it does
not modify a live deployment.
