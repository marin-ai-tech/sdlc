/**
 * Run the calculator e2e (unless --skip-test), then build en + ru demo decks.
 * Usage: node scripts/demo/build-all.mjs [--skip-test]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const transcript = path.join(root, 'docs/demo/calculator-transcript.json');
const buildDeck = path.join(root, 'scripts/demo/build-deck.mjs');
const skipTest = process.argv.includes('--skip-test');

function run(cmd, args, env = {}, shell = false) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status ?? 1;
}

if (!skipTest) {
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const code = run('npx', ['vitest', 'run', 'test/e2e-calculator.test.ts'], {
    SDLC_DEMO_TRANSCRIPT: transcript,
  }, true);
  // A deck from a red run would show failures as the product's behaviour: stop instead.
  if (code !== 0) process.exit(code);
}

const outs = [
  ['en', path.join(root, 'docs/demo/scdl-calculator-demo.en.pptx')],
  ['ru', path.join(root, 'docs/ru/demo/scdl-calculator-demo.ru.pptx')],
];

for (const [lang, out] of outs) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const code = run(process.execPath, [
    buildDeck, '--transcript', transcript, '--lang', lang, '--out', out,
  ]);
  if (code !== 0) process.exit(code);
}

process.exit(0);
