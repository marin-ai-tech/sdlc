import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/index.js';
import { humanEnv, REPO_ROOT, runCli, tempDir } from './helpers.js';

/**
 * 0.9.1: `sdlc guide [topic]` — short articles about working with sdlc, shipped in the package (assets/guide/<locale>/)
 * so they always match the installed version, in English and Russian. `topic#section` prints one section; the
 * `denials` topic has one section per hook rule, which the hook's reasons point to.
 */

const TOPICS = [
  'start', 'lifecycle', 'gates', 'roles', 'tracks', 'bugfix', 'backlog', 'rework', 'verify', 'review', 'mcp', 'config',
  'denials', 'faq',
];
const RULES = [
  'agent-marker', 'cli-removal', 'guard-config', 'mcp-stage', 'plan-gate', 'protected-path', 'release-gate',
  'secret-in-edit', 'separation-of-duties', 'state-integrity', 'takeover', 'tests-locked',
];
const MAX_BYTES = 4096;

function guide(args: string[], locale?: string) {
  const env = humanEnv(tempDir('sdlc-home-'));
  const extra = locale ? ['--locale', locale] : [];
  return runCli(['guide', ...args, ...extra], tempDir('sdlc-guide-'), env);
}

/** Every command path of the CLI, e.g. `approve`, `backlog move`, `mcp serve`. */
function cliCommands(): Set<string> {
  const all = new Set<string>();
  const walk = (c: ReturnType<typeof buildProgram>, prefix: string) => {
    for (const s of c.commands) {
      const name = prefix ? `${prefix} ${s.name()}` : s.name();
      all.add(name);
      walk(s, name);
    }
  };
  walk(buildProgram(), '');
  return all;
}

function article(locale: string, topic: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'assets/guide', locale, `${topic}.md`), 'utf-8');
}

describe('sdlc guide', () => {
  it('lists the topics with a title and a summary, outside any project', () => {
    const r = guide(['--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const topics = r.json().topics as Array<{ id: string; title: string; summary: string }>;
    expect(topics.map((t) => t.id)).toEqual(TOPICS);
    for (const t of topics) expect(t.title && t.summary, t.id).toBeTruthy();
  }, 60000);

  it('prints a topic in the chosen language', () => {
    const en = guide(['gates', '--json']).json();
    expect(en).toMatchObject({ topic: 'gates', locale: 'en' });
    expect(en.body).toMatch(/sdlc approve/);
    const ru = guide(['gates', '--json'], 'ru').json();
    expect(ru.locale).toBe('ru');
    expect(ru.body).toMatch(/[А-Яа-я]/);
    expect(guide(['gates']).stdout).toContain('sdlc approve');
  }, 60000);

  it('prints one section with topic#section; the denials topic covers every hook rule', () => {
    const one = guide(['denials#plan-gate', '--json']).json();
    expect(one.body).toMatch(/plan-gate/);
    expect(one.body).not.toMatch(/tests-locked/);
    for (const locale of ['en', 'ru']) {
      const text = article(locale, 'denials');
      for (const rule of RULES) expect(text, `${locale}: ${rule}`).toMatch(new RegExp(`^## ${rule}$`, 'm'));
    }
  }, 60000);

  it('negative: an unknown topic or section is an error that lists the topics', () => {
    const r = guide(['nope', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('unknown_guide_topic');
    expect(r.stdout).toContain('gates');
    expect(guide(['denials#nope', '--json']).json().status[0].code).toBe('unknown_guide_topic');
  }, 60000);

  it('articles exist in both languages, stay short, and name only real commands', () => {
    const commands = cliCommands();
    for (const locale of ['en', 'ru']) {
      for (const topic of TOPICS) {
        const text = article(locale, topic);
        expect(Buffer.byteLength(text), `${locale}/${topic}`).toBeLessThanOrEqual(topic === 'denials' ? 3 * MAX_BYTES : MAX_BYTES);
        for (const m of text.matchAll(/`sdlc ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)) {
          const two = m[2] ? `${m[1]} ${m[2]}` : undefined;
          const known = commands.has(m[1]) || (two !== undefined && commands.has(two));
          expect(known, `${locale}/${topic}: sdlc ${m[1]}`).toBe(true);
        }
      }
    }
  });
});
