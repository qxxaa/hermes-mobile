#!/bin/sh
set -eu

image=${1:?usage: tests/container/run-smoke.sh IMAGE}
fixture_node='node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e'
network=hermes-mobile-smoke-$$
backend=hermes-mobile-backend-$$
frontend=hermes-mobile-frontend-$$
replacement=hermes-mobile-replacement-$$
probe=hermes-mobile-probe-$$
stage=initialization

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  if [ "$status" -ne 0 ]; then
    printf 'smoke test failed at stage: %s (exit %s)\n' "$stage" "$status" >&2
    for container in "$frontend" "$backend" "$replacement" "$probe"; do
      printf 'diagnostics for %s\n' "$container" >&2
      timeout 5s docker logs --tail 80 "$container" >&2
      timeout 5s docker inspect --format '{{.Id}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}} {{json .NetworkSettings.Networks}}' "$container" >&2
    done
    timeout 5s docker network inspect "$network" >&2
  fi
  timeout 10s docker rm -f "$probe" "$frontend" "$frontend-invalid" "$backend" "$replacement" >/dev/null 2>&1
  timeout 10s docker network rm "$network" >/dev/null 2>&1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_client() {
  client=$1
  shift
  timeout 60s docker run --rm --name "$probe" --network "$network" \
    -v "$PWD/tests/container/$client:/$client:ro" "$fixture_node" node "/$client" "$@"
}

stage=image-labels

source_label=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' "$image")
revision_label=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
version_label=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")
test "$source_label" = "https://github.com/${GITHUB_REPOSITORY:-qxxaa/hermes-mobile}"
if [ -n "${GITHUB_SHA:-}" ]; then test "$revision_label" = "$GITHUB_SHA"; fi
printf '%s' "$revision_label" | grep -Eq '^[0-9a-f]{40}$'
test -n "$version_label"

stage=invalid-startup
if missing_env=$(timeout 20s docker run --rm --name "$frontend-invalid" "$image" 2>&1); then
  printf '%s\n' 'container unexpectedly started without HERMES_GATEWAY_URL' >&2
  exit 1
fi
printf '%s' "$missing_env" | grep -Fq 'invalid HERMES_GATEWAY_URL: it is required'
if malformed_env=$(timeout 20s docker run --rm --name "$frontend-invalid" -e HERMES_GATEWAY_URL=not-a-url "$image" 2>&1); then
  printf '%s\n' 'container unexpectedly started with malformed HERMES_GATEWAY_URL' >&2
  exit 1
fi
printf '%s' "$malformed_env" | grep -Fq 'invalid HERMES_GATEWAY_URL: must start with http:// or https://'

stage=network-and-backend-startup
docker network create "$network" >/dev/null
docker run -d --name "$backend" --network "$network" --network-alias gateway \
  -v "$PWD/tests/container/fixture-backend.mjs:/fixture-backend.mjs:ro" "$fixture_node" \
  node /fixture-backend.mjs >/dev/null
docker run -d --name "$frontend" --network "$network" -e HERMES_GATEWAY_URL=http://gateway:9119 \
  "$image" >/dev/null

stage=original-backend-readiness
run_client fixture-ready-client.mjs "$backend" 9119 first
stage=frontend-backend-readiness
run_client fixture-ready-client.mjs "$frontend" 80 first
frontend_identity=$(docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$frontend")

stage=nginx-and-build-metadata

docker exec "$frontend" nginx -t

stamp=$(timeout 8s docker exec "$frontend" wget -T 5 -qO- http://127.0.0.1/build-info.json)
printf '%s' "$stamp" | grep -Fq "\"commit\": \"$revision_label\""
printf '%s' "$stamp" | grep -Fq '"source": "ci"'

stage=static-routing-and-cache
root=$(timeout 8s docker exec "$frontend" wget -T 5 -qO- http://127.0.0.1/)
deep_link=$(timeout 8s docker exec "$frontend" wget -T 5 -qO- http://127.0.0.1/a/deep/link)
test "$root" = "$deep_link"
headers=$(timeout 8s docker exec "$frontend" wget -T 5 -S -O /dev/null http://127.0.0.1/assets/does-not-exist.js 2>&1 || true)
printf '%s' "$headers" | grep -q '404 Not Found'
cache=$(timeout 8s docker exec "$frontend" wget -T 5 -S -O /dev/null http://127.0.0.1/sw.js 2>&1 || true)
printf '%s' "$cache" | grep -q '200 OK'
printf '%s' "$cache" | grep -qi 'Cache-Control: no-cache'
asset=$(printf '%s' "$root" | sed -n 's/.*src="\([^"?]*\/assets\/[^"?]*\.js\)".*/\1/p' | head -n 1)
test -n "$asset"
asset=${asset#./}
asset=/${asset#/}
asset_headers=$(timeout 8s docker exec "$frontend" wget -T 5 -S -O /dev/null "http://127.0.0.1$asset" 2>&1 || true)
printf '%s' "$asset_headers" | grep -q '200 OK'
printf '%s' "$asset_headers" | grep -qi 'Cache-Control: public, max-age=31536000, immutable'
generic_static_headers=$(timeout 8s docker exec "$frontend" wget -T 5 -S -O /dev/null http://127.0.0.1/build-info.json 2>&1 || true)
printf '%s' "$generic_static_headers" | grep -q '200 OK'
printf '%s' "$generic_static_headers" | grep -qi 'Cache-Control: no-cache'

stage=request-forwarding
echo_response=$(timeout 8s docker exec "$frontend" wget -T 5 -qO- --header='Cookie: session=kept' --post-data='body=kept' 'http://127.0.0.1/api/echo?query=kept')
printf '%s' "$echo_response" | grep -q '"query":"?query=kept"'
printf '%s' "$echo_response" | grep -q '"body":"body=kept"'
printf '%s' "$echo_response" | grep -q '"forwardedProto":"http"'
printf '%s' "$echo_response" | grep -q '"cookie":"session=kept"'

stage=websocket
run_client fixture-websocket-client.mjs "$frontend" 80

stage=redirect
run_client fixture-redirect-client.mjs "$frontend" 80

stage=streaming
run_client fixture-stream-client.mjs "$frontend" 80

stage=replacement-allocation
old_backend_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$backend")
# Allocate while the original still owns its IP. Both briefly advertise gateway;
# after removal only the replacement remains. No static IP or subnet assumptions.
docker run -d --name "$replacement" --network "$network" --network-alias gateway \
  -e INSTANCE=replaced -v "$PWD/tests/container/fixture-backend.mjs:/fixture-backend.mjs:ro" "$fixture_node" \
  node /fixture-backend.mjs >/dev/null
new_backend_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$replacement")
test -n "$old_backend_ip" && test -n "$new_backend_ip"
test "$new_backend_ip" != "$old_backend_ip"
printf 'backend address change: %s -> %s\n' "$old_backend_ip" "$new_backend_ip"
stage=replacement-readiness
run_client fixture-ready-client.mjs "$replacement" 9119 replaced
stage=remove-original-backend
docker rm -f "$backend" >/dev/null
stage=dns-recovery
run_client fixture-ready-client.mjs "$frontend" 80 replaced
stage=frontend-identity-unchanged
test "$frontend_identity" = "$(docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$frontend")"

printf '%s\n' 'container smoke test passed'
