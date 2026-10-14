import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { catalog } from '../src/core/i18n.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Defects found while recording the course videos (0.20.2):
 * - a plan-gate denial named its guide section twice ("See `sdlc guide denials#plan-gate`. Why, and what to do:
 *   `sdlc guide denials#plan-gate`."): the message carried the pointer and the hook adds it to every denial;
 * - with the debate lens, `sdlc next` read "agent — Agent: record the debate …": the message repeated its actor.
 */

function project() {
  const root = tempDir('sdlc-video-findings-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.enforcement.mode = 'block';
  write(file, stringify(config));
  const hook = (input: Record<string, unknown>) =>
    runCli(['hook', 'pre-tool'], root, env, JSON.stringify({ cwd: root, ...input })).stdout;
  return { root, env, hook };
}

const count = (text: string, part: string) => text.split(part).length - 1;

describe('texts found while recording the videos', () => {
  it('a plan-gate denial names its guide section once, with or without an active change', () => {
    const p = project();
    const edit = { tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'src/app.js') } };
    expect(count(p.hook(edit), 'denials#plan-gate')).toBe(1);
    expect(runCli(['new', 'add-x', '--json'], p.root, p.env).code).toBe(0);
    expect(count(p.hook(edit), 'denials#plan-gate')).toBe(1);
  }, 180000);

  it('no next-step message repeats the actor the Next line already names, in any locale', () => {
    for (const locale of ['en', 'ru'] as const) {
      const bad = Object.entries(catalog(locale))
        .filter(([key, text]) => key.startsWith('next.') && /^(Agent|Person|Агент|Человек)\s*:/.test(text))
        .map(([key]) => key);
      expect(bad, locale).toEqual([]);
    }
  });
});
