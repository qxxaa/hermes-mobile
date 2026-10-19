# Publish a ready-to-run frontend image

I've been testing Hermes Mobile on a self-hosted setup. Publishing a container
image would remove the need to compile the frontend on the deployment host.

The `feat/container-publishing` branch of `qxxaa/hermes-mobile` is a POC:
- Multi-stage frontend build and nginx runtime, without bundling Hermes Agent.
- Configurable gateway origin with same-origin authentication and WebSockets.
- GHCR workflow with source metadata, a moving tag and retained rollback tags.
- A small Compose example with no build tools on the deployment host.

Local helper tests and real nginx transport checks have passed. Container CI,
publication to `ghcr.io/qxxaa/hermes-mobile`, and deployed-image verification
are still pending; this draft is not yet a claim of a published working image.

The fork targets each update to main for personal use. Upstream can choose
release builds, manual publication, or another cadence, along with its own
tagging policy. This does not require changing the backend or using a fork of
Hermes Agent.
