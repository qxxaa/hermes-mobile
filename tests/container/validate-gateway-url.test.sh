#!/bin/sh
set -eu

validator="${1:-./deploy/container/15-validate-gateway.sh}"
conf_dir=$(mktemp -d)
trap 'rm -rf "$conf_dir"' EXIT

expect_valid() {
  HERMES_NGINX_CONF_DIR="$conf_dir" HERMES_GATEWAY_URL="$1" sh "$validator" >/dev/null
}

expect_invalid() {
  if HERMES_NGINX_CONF_DIR="$conf_dir" HERMES_GATEWAY_URL="$1" sh "$validator" >/dev/null 2>&1; then
    printf 'expected invalid gateway URL to fail: %s\n' "$1" >&2
    exit 1
  fi
}

expect_valid 'http://gateway'
expect_valid 'https://gateway.example.lan/'
expect_valid 'http://192.168.89.100:9119'
expect_valid 'https://gateway.example.lan:443/'

expect_invalid ''
expect_invalid ' gateway.example.lan'
expect_invalid 'http://user:pass@gateway.example.lan'
expect_invalid 'https://gateway.example.lan/api'
expect_invalid 'https://gateway.example.lan/?query=1'
expect_invalid 'https://gateway.example.lan/#fragment'
expect_invalid 'ftp://gateway.example.lan'
expect_invalid 'http://gateway.example.lan:0'
expect_invalid 'http://gateway.example.lan:65536'
expect_invalid 'http://999.168.89.100'
expect_invalid 'http://gateway.example.lan;proxy_pass http://attacker'
