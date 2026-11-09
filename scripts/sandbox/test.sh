#!/usr/bin/env bash
# Runs on the server, read from standard input: bash -s -- <bare repository> <commit> [command...]
# Tests a pushed commit in a container with the limits the other projects on this server use.
# Exit codes: 2 refused input, 3 the commit is not on a branch of the repository, 75 the server stayed busy or ran out
# of disk, 124 no result in time, 129 the client went away, 143 stopped by TERM. Anything else is the container's code
# or a failing tool on this host.
# Whatever the container wrote is hostile: $RUN/evidence is writable from inside, so this script never reads or writes
# a file there. It only makes, mounts and removes the folder.
set -euo pipefail

# A command run stays under verify's limit of 3600 seconds, or verify kills the client with no exit code: everything up
# to the end of the container counts against the total, and the three steps after it have limits of their own.
TOTAL_LIMIT_SECONDS=3300
LOCK_WAIT_SECONDS=600
MEMORY_WAIT_SECONDS=600
COMMAND_LIMIT_SECONDS=2100
SUITE_LIMIT_SECONDS=7200
BUILD_LIMIT_SECONDS=1200
CONTROL_LIMIT_SECONDS=60
LOG_LIMIT_SECONDS=120
POLL_SECONDS=15
MEMORY_NEEDED_MB=4096
DISK_NEEDED_MB=10240
DISK_FLOOR_MB=5120
RUNS="$HOME/sandbox_runs/sdlc"
NAME=""
RUN=""
CONTEXT=""

resolve_commit() {
  if ! git --git-dir="$REPO" rev-parse --git-dir > /dev/null 2>&1; then
    echo "NO REPOSITORY: nothing usable at the path given"
    exit 2
  fi
  FULL="$(git --git-dir="$REPO" rev-parse --verify --quiet "$REV^{commit}")" || FULL=""
  if [ -z "$FULL" ] || [ -z "$(git --git-dir="$REPO" branch --contains "$FULL")" ]; then
    echo "NOT PUSHED: $REV is not on a branch of the repository; push it first"
    exit 3
  fi
}

# A hung docker must not hold the run and the lock. A failure here stops the script unless the caller guards it.
control() {
  timeout "$CONTROL_LIMIT_SECONDS" docker "$@" 9>&-
}

# A child that keeps descriptor 9 keeps the lock after this script is killed, so children that can outlive it close it.
take_lock() {
  mkdir -p "$RUNS"
  exec 9>"$RUNS/.lock"
  if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
    echo "SANDBOX BUSY: another sdlc run held the lock for ${LOCK_WAIT_SECONDS}s"
    exit 75
  fi
}

remove_folder() {
  chmod -R u+rwX "$1" 2> /dev/null || true
  rm -rf "$1" || echo "warning: could not remove ${1#"$HOME"/}"
}

# Holding the lock, anything left under this project's name belongs to a run that was killed.
remove_leftovers() {
  control ps -aq --filter 'name=^sdlc-sandbox-' \
    | xargs -r timeout "$CONTROL_LIMIT_SECONDS" docker rm -f > /dev/null 9>&-
  local folder
  for folder in "$RUNS"/sdlc-sandbox-*/source "$RUNS"/sdlc-sandbox-*/scratch; do
    if [ -e "$folder" ]; then remove_folder "$folder"; fi
  done
}

# Other projects may run at the same time; the production bot keeps its room.
wait_for_memory() {
  local waited=0 available
  while true; do
    available="$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)"
    [ "$available" -ge "$MEMORY_NEEDED_MB" ] && break
    if [ "$waited" -ge "$MEMORY_WAIT_SECONDS" ]; then
      echo "SANDBOX BUSY: only ${available} MB of memory available after ${waited}s"
      exit 75
    fi
    sleep 30 9>&-
    waited=$((waited + 30))
  done
  local others
  others="$(control ps --format '{{.Names}}' | grep -c sandbox || true)"
  echo "available memory: ${available} MB; other sandboxes: $others"
}

free_disk_mb() {
  df -Pm "$RUNS" | awk 'NR == 2 {print $4}'
}

check_disk() {
  local free
  free="$(free_disk_mb)"
  if [ "$free" -lt "$DISK_NEEDED_MB" ]; then
    echo "SANDBOX BUSY: only ${free} MB of disk free, ${DISK_NEEDED_MB} MB needed"
    exit 75
  fi
}

# A link in the commit would make this host read the file behind it, so only regular files are taken.
read_input() {
  local input="$1" target="$2" mode
  mode="$(git --git-dir="$REPO" ls-tree "$FULL" -- "$input" | cut -d' ' -f1)"
  if [ "$mode" != "100644" ]; then
    echo "REFUSED: $input in ${FULL:0:8} is not a regular file"
    exit 2
  fi
  git --git-dir="$REPO" cat-file blob "$FULL:$input" > "$target"
}

ensure_image() {
  local tag
  CONTEXT="$(mktemp -d)"
  read_input package.json "$CONTEXT/package.json"
  read_input package-lock.json "$CONTEXT/package-lock.json"
  read_input scripts/sandbox/Dockerfile "$CONTEXT/Dockerfile"
  tag="$(cd "$CONTEXT" && sha256sum package.json package-lock.json Dockerfile | sha256sum | cut -d' ' -f1)"
  IMAGE="sdlc-sandbox:$tag"
  if ! control image inspect "$IMAGE" > /dev/null 2>&1; then
    echo "building sdlc-sandbox:${tag:0:16}"
    timeout "$BUILD_LIMIT_SECONDS" docker build -q -t "$IMAGE" "$CONTEXT" > /dev/null 9>&-
  fi
  rm -rf "$CONTEXT"
  CONTEXT=""
  control images sdlc-sandbox --format '{{.Repository}}:{{.Tag}}' \
    | grep -vx "$IMAGE" | xargs -r timeout "$CONTROL_LIMIT_SECONDS" docker rmi > /dev/null 9>&- || true
}

# What a test wrote to fill the disk would stay until a person removes it, and refuse every later run.
give_back_disk() {
  local free
  free="$(free_disk_mb)" || return 0
  if [ -n "$free" ] && [ "$free" -lt "$DISK_NEEDED_MB" ]; then
    remove_folder "$RUN/evidence" > /dev/null
    echo "only $free MB of disk free: removed what this run's container wrote"
  fi
}

cleanup() {
  if [ -n "$CONTEXT" ]; then rm -rf "$CONTEXT" || true; fi
  if [ -n "$NAME" ]; then control rm -f "$NAME" > /dev/null 2>&1 || true; fi
  if [ -n "$RUN" ]; then
    remove_folder "$RUN/source" > /dev/null
    remove_folder "$RUN/scratch" > /dev/null
    give_back_disk || true
  fi
}

prepare_run() {
  NAME="sdlc-sandbox-${FULL:0:8}-$(date +%Y%m%d_%H%M%S)"
  RUN="$RUNS/$NAME"
  mkdir -p "$RUN/scratch/home" "$RUN/scratch/tmp" "$RUN/evidence"
  git clone -q --no-hardlinks "$REPO" "$RUN/source" 9>&-
  git -C "$RUN/source" checkout -q --detach "$FULL"
}

start_container() {
  control run -d --name "$NAME" --label com.centurylinklabs.watchtower.enable=false \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user "$(id -u):$(id -g)" --memory 3g --cpus 2 --cpu-shares 256 --pids-limit 1024 --shm-size 256m \
    --log-opt max-size=20m --log-opt max-file=2 \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=512m \
    -v "$RUN/source:/workspace" \
    -v "$RUN/scratch:/scratch" \
    -v "$RUN/evidence:/evidence" \
    -e LANG=C.UTF-8 -e HOME=/scratch/home -e TMPDIR=/scratch/tmp -e USER=sandbox -e LOGNAME=sandbox \
    -e CI=1 -e NO_COLOR=1 \
    --workdir /workspace \
    "$IMAGE" bash scripts/sandbox/run.sh "$@" > /dev/null
  echo "sandbox $NAME: ${FULL:0:8} started $(date +%T)"
}

parent_pid() {
  ps -o ppid= -p "$$" | tr -d ' '
}

# One failed read of the parent says nothing; a parent that became init means the client is gone.
client_gone() {
  local now
  now="$(parent_pid)" || return 1
  [ -n "$now" ] || return 1
  [ "$now" != "$PARENT" ] || [ "$now" = "1" ]
}

# sshd sends no signal when a client without a terminal goes, so the run looks for itself. Waiting in the background
# with the wait builtin is what lets a trap fire during the wait.
watch_run() {
  local waiter="$1" free
  while kill -0 "$waiter" 2> /dev/null; do
    if client_gone; then exit 129; fi
    free="$(free_disk_mb)"
    if [ "$free" -lt "$DISK_FLOOR_MB" ]; then
      echo "SANDBOX BUSY: only ${free} MB of disk left, run stopped"
      exit 75
    fi
    sleep "$POLL_SECONDS" > /dev/null 2>&1 9>&- &
    wait "$!" || true
  done
}

# What the waits and a build used comes off a command's limit. timeout 0 would mean no limit at all.
run_limit() {
  local left=$((TOTAL_LIMIT_SECONDS - SECONDS))
  if [ "$1" -eq 0 ]; then
    echo "$SUITE_LIMIT_SECONDS"
  elif [ "$left" -lt 1 ]; then
    echo 1
  elif [ "$left" -lt "$COMMAND_LIMIT_SECONDS" ]; then
    echo "$left"
  else
    echo "$COMMAND_LIMIT_SECONDS"
  fi
}

wait_for_result() {
  local limit rc="" waiter
  limit="$(run_limit "$#")"
  timeout "$limit" docker wait "$NAME" > "$RUN/exit-code" 2> /dev/null 9>&- &
  waiter="$!"
  watch_run "$waiter"
  if wait "$waiter"; then
    rc="$(cat "$RUN/exit-code")"
  else
    echo "NO RESULT after ${limit}s"
    control kill "$NAME" > /dev/null || true
    rc=124
  fi
  # An exit code is at most 255, and return would wrap 256 to 0.
  if ! [[ "$rc" =~ ^[0-9]{1,3}$ ]] || [ "$rc" -gt 255 ]; then rc=1; fi
  timeout "$LOG_LIMIT_SECONDS" docker logs "$NAME" > "$RUN/run.log" 2>&1 9>&- || true
  # The container's output comes first with control bytes gone, so it can neither steer the terminal nor end the record.
  cut -c1-200 "$RUN/run.log" | tr -d '\000-\010\013-\037\177' | tail -n 80 || true
  echo "sandbox finished $(date +%T), exit=$rc, logs: ${RUN#"$HOME"/}"
  return "$rc"
}

main() {
  exec < /dev/null
  REPO="${1:?bare repository required}"
  REV="${2:?commit required}"
  shift 2
  PARENT="$(parent_pid)"
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 143' TERM
  resolve_commit
  if client_gone; then exit 129; fi
  take_lock
  if client_gone; then exit 129; fi
  remove_leftovers
  wait_for_memory
  check_disk
  ensure_image
  prepare_run
  start_container "$@"
  wait_for_result "$@"
}

# The whole script is parsed before anything runs: a dropped connection cannot run half of it.
main "$@"
