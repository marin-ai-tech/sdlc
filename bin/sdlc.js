#!/usr/bin/env node
// A closed pipe (e.g. `sdlc status | head -1`) is a normal way for output to end.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error && error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
  });
}

// Hooks run on every agent tool call, so `sdlc hook` skips loading the full CLI.
const argv = process.argv;
const denyAgents = new Set(['codex', 'qwen', 'gigacode']);
const denyReason = '[sdlc] The SDLC harness check could not run (sdlc hook pre-tool failed), ' +
  'so this call is blocked. Retry the call; if it keeps failing, run `sdlc doctor`.';
const agentIndex = argv.indexOf('--agent');
const agent = agentIndex > 0 ? argv[agentIndex + 1] : undefined;
const failClosed = argv[2] === 'hook' && argv[3] === 'pre-tool' && denyAgents.has(agent);
let answered = false;
let failed = false;

function denyFailedHook(error) {
  if (failed) return;
  failed = true;
  if (answered) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const answer = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReason,
    },
  };
  process.stdout.write(`${JSON.stringify(answer)}\n`, () => process.exit(0));
}

if (failClosed) {
  const originalWrite = process.stdout.write;
  process.stdout.write = function (...args) {
    answered = true;
    return originalWrite.apply(this, args);
  };
  process.on('uncaughtException', denyFailedHook);
  process.on('unhandledRejection', denyFailedHook);
}

const main = argv[2] === 'hook'
  ? import('../dist/hook.js').then(({ runHook }) => {
      return runHook(argv[3] ?? '', agent);
    })
  : import('../dist/cli/index.js').then(({ run }) => run(argv));

main.catch((error) => {
  if (failClosed) {
    denyFailedHook(error);
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
