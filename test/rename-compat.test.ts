import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

const INTENT = '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

/** A project as the package wrote it before the rename: `scdl:` keys and the old provenance line. */
function legacyProject() {
  const root = tempDir('sdlc-legacy-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'old-change', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/old-change');
  write(path.join(dir, 'intent.md'), INTENT);
  expect(cli(['approve', 'intent', '--change', 'old-change', '--json']).code).toBe(0);
  const legacy = (file: string, from: RegExp, to: string) => write(file, read(file).replace(from, to));
  legacy(path.join(dir, '.sdlc.yaml'), /\bsdlc:/g, 'scdl:');
  legacy(path.join(dir, 'intent.md'), /sdlc-provenance: sdlc /g, 'sdlc-provenance: scdl ');
  legacy(path.join(dir, 'intent.md'), /marin-ai-tech\/sdlc/g, 'marin-ai-tech/scdl');
  legacy(path.join(root, 'openspec/.sdlc/log.jsonl'), /"sdlc":/g, '"scdl":');
  return { root, dir, cli };
}

describe('projects written before the rename from scdl', () => {
  it('the fixture really is in the old format', () => {
    const { root, dir } = legacyProject();
    expect(read(path.join(dir, '.sdlc.yaml'))).toMatch(/\bscdl:/);
    expect(read(path.join(dir, '.sdlc.yaml'))).not.toMatch(/\bsdlc:/);
    expect(read(path.join(dir, 'intent.md'))).toMatch(/sdlc-provenance: scdl /);
    expect(read(path.join(root, 'openspec/.sdlc/log.jsonl'))).toMatch(/"scdl":/);
  });

  it('an approval stamped by scdl stays approved: the old provenance line is still left out of the digest', () => {
    const { cli } = legacyProject();
    type Status = { change: { gates: Array<{ id: string; status: string }> } };
    const status = cli(['status', '--change', 'old-change', '--json']).json<Status>();
    expect(status.change.gates.find((g) => g.id === 'intent')?.status).toBe('approved');
  });

  it('the log and the audit still show the version recorded under the old key', () => {
    const { cli } = legacyProject();
    const log = cli(['log', '--json']).json<{ entries: Array<{ sdlc?: string; event: string }> }>();
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.entries.every((e) => typeof e.sdlc === 'string')).toBe(true);
    expect(cli(['log']).stdout).toMatch(/\[sdlc \d+\.\d+\.\d+/);
  });

  it('new writes use the new key and replace the old provenance line', () => {
    const { dir, cli } = legacyProject();
    expect(cli(['reject', 'intent', '--change', 'old-change', '--note', 'again', '--json']).code).toBe(0);
    const state = parse(read(path.join(dir, '.sdlc.yaml')));
    expect(state.harness.sdlc).toMatch(/^\d+\.\d+\.\d+/);
    expect(read(path.join(dir, '.sdlc.yaml'))).not.toMatch(/^\s*harness:\s*\n\s*scdl:/m);
    const rejection = state.gates.intent.rejection;
    expect(rejection.sdlc).toMatch(/^\d+\.\d+\.\d+/);
    expect(rejection.scdl).toBeUndefined();
  });

  it('negative: the hook still denies `scdl approve` to agents (the old name is not a way around it)', () => {
    const root = tempDir('sdlc-legacy-hook-');
    const ctx = { paths: projectPaths(root), config: defaultConfig() };
    for (const command of ['scdl approve plan --change x', 'npx scdl approve review --change x']) {
      expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx).decision, command).toBe('deny');
    }
  });

  it('the scdl command still works for one version and says it is deprecated', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin/scdl.js'), '--version'], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.stderr).toMatch(/deprecated.*sdlc/i);
  });

  it('negative: nothing in the repository points at the old name, apart from the deliberate compatibility spots', () => {
    const r = spawnSync('git', ['grep', '-n', '-I', '-i', 'scdl', '--', '.', ':!test/rename-compat.test.ts', ':!package-lock.json',
      ':!CHANGELOG.md'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const allowed = [/^package\.json:.*"scdl": "\.\/bin\/scdl\.js"/, /^bin\/scdl\.js:/, /^src\/core\/policy\.ts:.*\(\?:sdlc\|scdl\)/,
      /^src\/integrations\/settings\.ts:/, /^src\/core\/license\.ts:.*\(\?:sdlc\|scdl\)/, /^src\/core\/(change-state|log)\.ts:.*scdl/,
      /^README\.md:.*under its old name \(`marin-ai-tech\/scdl`/];
    const leftovers = r.stdout.split('\n').filter((line) => line && !allowed.some((re) => re.test(line)));
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(path.join(REPO_ROOT, 'LICENSES/sdlc-Additional-Permissions.md'))).toBe(true);
  });
});
