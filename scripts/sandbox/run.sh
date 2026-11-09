#!/usr/bin/env bash
# Runs inside the container, from the checked-out commit in /workspace.
# Without arguments: compile, typecheck and the full suite in shards. With arguments: compile, then that one command.
set -uo pipefail
cd /workspace

cp -a /deps/node_modules /workspace/node_modules
mkdir -p "$HOME" "$TMPDIR"
cp -a /opt/npm-cache /scratch/npm-cache
export NPM_CONFIG_CACHE=/scratch/npm-cache
git config --global user.name sandbox
git config --global user.email sandbox@localhost
git config --global init.defaultBranch main

failed=()
step() {
  local name="$1"
  shift
  local started=$SECONDS
  echo "=== $name: $*"
  "$@" > "/evidence/$name.log" 2>&1
  local rc=$?
  echo "=== $name: exit=$rc, $((SECONDS - started))s"
  echo "$name exit=$rc $((SECONDS - started))s" >> /evidence/summary.txt
  if [ "$rc" -ne 0 ]; then
    failed+=("$name")
    tail -n 40 "/evidence/$name.log" | cut -c1-200
  else
    # A test may run a suite of its own, so only the last counts are this command's.
    grep -E '^ *(Test Files|Tests) ' "/evidence/$name.log" | tail -n 2 | cut -c1-200 || true
  fi
  return "$rc"
}

echo "node $(node -v), $(git --version)"
step compile npm run compile || exit 1

if [ "$#" -gt 0 ]; then
  step command "$@"
  exit $?
fi

WORKERS="${SANDBOX_WORKERS:-2}"
step typecheck npm run typecheck
for shard in 1/4 2/8 6/8 3/8 7/8 4/4; do
  step "test-${shard/\//-of-}" node scripts/test-shards.mjs --shard "$shard" --workers "$WORKERS"
done

echo "failed stages: ${failed[*]:-none}"
[ "${#failed[@]}" -eq 0 ]
