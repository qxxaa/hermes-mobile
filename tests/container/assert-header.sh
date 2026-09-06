#!/bin/sh
# wget prints raw headers with optional indentation. Fold names, never values.
set -eu
expected_name=${1:?header name required}
expected_value=${2:?header value required}
folded_name=$(printf '%s' "$expected_name" | tr '[:upper:]' '[:lower:]')
cr=$(printf '\r')
while IFS= read -r line || [ -n "$line" ]; do
  line=${line%"$cr"}
  line=${line#"${line%%[! 	]*}"}
  case "$line" in *:*) ;; *) continue ;; esac
  name=${line%%:*}
  value=${line#*:}
  value=${value#"${value%%[! 	]*}"}
  name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
  if [ "$name" = "$folded_name" ] && [ "$value" = "$expected_value" ]; then
    exit 0
  fi
done
printf 'missing expected header: %s: %s\n' "$expected_name" "$expected_value" >&2
exit 1
