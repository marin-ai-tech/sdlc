import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { BIN, read, tempDir, write } from './helpers.js';
import type { decisionProject } from './e20-decision-fixture.js';

export function preloadCli(p: ReturnType<typeof decisionProject>, args: string[], body: string) {
  const script = path.join(tempDir('sdlc-audit-preload-'), 'preload.mjs');
  write(script, ["import fs from 'node:fs';", "import cp from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';", body, 'syncBuiltinESMExports();'].join('\n'));
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(script).href, BIN, ...args],
    { cwd: p.root, env: p.env, encoding: 'utf8', timeout: 120000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr,
    json: () => JSON.parse(result.stdout) };
}

export function waiveFixtureGates(p: ReturnType<typeof decisionProject>, gates: string[]): void {
  const state = parse(read(p.stateFile));
  for (const gate of gates) state.gates[gate] = { waived: { by: 'Fixture', at: '2026-10-29', note: 'test setup' } };
  write(p.stateFile, stringify(state));
}
