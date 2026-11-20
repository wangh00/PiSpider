#!/usr/bin/env sh
set -eu
repo_root=$(CDPATH= cd "$(dirname "$0")" && pwd)
cd "$repo_root"
exec node "$repo_root/scripts/run-pispider.mjs" "$@"
