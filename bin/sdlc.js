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
const main = argv[2] === 'hook'
  ? import('../dist/hook.js').then(({ runHook }) => {
      const agentIndex = argv.indexOf('--agent');
      return runHook(argv[3] ?? '', agentIndex > 0 ? argv[agentIndex + 1] : undefined);
    })
  : import('../dist/cli/index.js').then(({ run }) => run(argv));

main.catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
