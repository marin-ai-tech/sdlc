/**
 * For each language: run the calculator e2e (unless --skip-test) with that language's team, then build its deck.
 * Usage: node scripts/demo/build-all.mjs [--skip-test]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Each language runs the scenario with its own team names (SDLC_DEMO_PEOPLE), so the output stays real. */
const DECKS = [
  { lang: 'en', dir: 'docs/demo' },
  { lang: 'ru', dir: 'docs/ru/demo' },
].map(({ lang, dir }) => ({
  lang,
  transcript: path.join(root, dir, `calculator-transcript.${lang}.json`),
  out: path.join(root, dir, `sdlc-calculator-demo.${lang}.pptx`),
}));
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

function scenario(deck) {
  fs.mkdirSync(path.dirname(deck.transcript), { recursive: true });
  const env = { SDLC_DEMO_TRANSCRIPT: deck.transcript, SDLC_DEMO_PEOPLE: deck.lang };
  // A deck from a red run would show failures as the product's behaviour: stop instead.
  const code = run('npx', ['vitest', 'run', 'test/e2e-calculator.test.ts'], env, true);
  if (code !== 0) process.exit(code);
}

function deckFile(deck) {
  fs.mkdirSync(path.dirname(deck.out), { recursive: true });
  const code = run(process.execPath, [buildDeck, '--transcript', deck.transcript, '--lang', deck.lang, '--out', deck.out]);
  if (code !== 0) process.exit(code);
}

for (const deck of DECKS) {
  if (!skipTest) scenario(deck);
  deckFile(deck);
}

process.exit(0);
