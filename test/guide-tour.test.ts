import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/index.js';
import { BIN, humanEnv, REPO_ROOT, runCli, tempDir } from './helpers.js';

const REPO = REPO_ROOT;

/**
 * 0.11.4 (docs/ru/25, B52): `sdlc guide tour [step]` walks a newcomer through the calculator demo in short steps, in
 * English and Russian, inside or outside a project.
 */

const env = humanEnv(tempDir('sdlc-home-'));
const cli = (args: string[]) => runCli(args, tempDir('sdlc-tour-'), env);

interface Tour {
  steps: Array<{ n: number; title: string }>;
  current: { n: number; title: string; body: string };
}

function tour(args: string[]): Tour {
  const r = cli(['guide', 'tour', ...args, '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.json().tour;
}

describe('B52: the guided tour', () => {
  it('without a step it lists the steps and opens the first; a number opens that step', () => {
    const index = tour([]);
    expect(index.steps.length).toBeGreaterThanOrEqual(6);
    expect(index.current.n).toBe(1);
    const third = tour(['3']);
    expect(third.current.n).toBe(3);
    expect(third.current.title).toBe(index.steps[2].title);
    expect(third.current.body.length).toBeGreaterThan(200);
  }, 120000);

  it('the steps cover the whole demo and exist in both languages', () => {
    const en = tour([]);
    const all = en.steps.map((step) => tour([String(step.n)]).current.body).join('\n');
    for (const command of ['sdlc init', 'sdlc approve', 'sdlc verify', 'sdlc archive', 'sdlc health']) {
      expect(all, command).toContain(command);
    }
    const r = cli(['guide', 'tour', '--json', '--locale', 'ru']);
    expect(r.json().tour.steps).toHaveLength(en.steps.length);
    expect(r.json().tour.current.body).toMatch(/[а-я]/);
  }, 180000);

  it('every step stays short and names only real commands, in code blocks too', () => {
    const commands = new Set<string>();
    const walk = (c: ReturnType<typeof buildProgram>, prefix: string) => {
      for (const s of c.commands) {
        const name = prefix ? `${prefix} ${s.name()}` : s.name();
        commands.add(name);
        walk(s, name);
      }
    };
    walk(buildProgram(), '');
    for (const locale of ['en', 'ru']) {
      const dir = path.join(REPO, 'assets/guide', locale, 'tour');
      for (const file of fs.readdirSync(dir)) {
        const text = fs.readFileSync(path.join(dir, file), 'utf-8');
        expect(Buffer.byteLength(text), `${locale}/${file}`).toBeLessThanOrEqual(4096);
        for (const m of text.matchAll(/(?:`|^\s*)sdlc ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/gm)) {
          const two = m[2] ? `${m[1]} ${m[2]}` : undefined;
          const known = commands.has(m[1]) || (two !== undefined && commands.has(two));
          expect(known, `${locale}/${file}: sdlc ${m[1]}`).toBe(true);
        }
      }
    }
  });

  it('negative: a step that does not exist is an error, not an empty page', () => {
    const r = cli(['guide', 'tour', '99', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).not.toBe(undefined);
    expect(BIN).toBeTruthy();
  }, 120000);
});
