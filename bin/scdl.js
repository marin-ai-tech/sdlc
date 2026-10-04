#!/usr/bin/env node
// The package was called scdl before 0.6.2; the old command name keeps working for one more version.
// Hooks stay silent: their output goes to the agent, and old hooks keep running until `sdlc update`.
if (process.argv[2] !== 'hook') {
  process.stderr.write('warning: `scdl` is deprecated and will be removed in the next version; use `sdlc`.\n');
}
await import('./sdlc.js');
