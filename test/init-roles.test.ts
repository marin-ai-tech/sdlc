import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

/**
 * B102 (0.16.1): `sdlc init --roles` creates the starter openspec/roles.yaml (the git identity holding every role),
 * as the interactive init does when asked; an existing roles.yaml is kept. roles.yaml decides who may approve, so an
 * agent may not create it: the CLI refuses `init --roles` in an agent session and the hook denies the command, as for
 * `sdlc roles migrate` and `sdlc adopt --apply`. A plain `sdlc init` is unchanged.
 */

function project() {
  const root = tempDir('sdlc-init-roles-');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Maria Ruiz']);
  git(root, ['config', 'user.email', 'maria@nw.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const roles = path.join(root, 'openspec/roles.yaml');
  return { root, cli, roles };
}

describe('B102: sdlc init --roles', () => {
  it('creates the starter roles.yaml for the git identity', () => {
    const p = project();
    const r = p.cli(['init', '--tools', 'none', '--roles', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.stringify(r.json())).toMatch(/created/);
    const file = parse(read(p.roles));
    const ids = Object.keys(file.people);
    expect(ids).toHaveLength(1);
    expect(file.people[ids[0]].emails).toEqual(['maria@nw.example']);
    expect(file.roles['product-owner']).toEqual(ids);
    expect(file.roles['code-owner']).toEqual(ids);
  }, 120000);

  it('keeps an existing roles.yaml', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--roles', '--json']).code).toBe(0);
    fs.appendFileSync(p.roles, '# the team edited this\n');
    const before = read(p.roles);
    const again = p.cli(['init', '--tools', 'none', '--roles', '--json']);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(JSON.stringify(again.json())).toMatch(/kept/);
    expect(read(p.roles)).toBe(before);
  }, 120000);

  it('negative: plain init creates no roles.yaml', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(fs.existsSync(p.roles)).toBe(false);
  }, 120000);

  it('an agent may not create roles.yaml: the CLI refuses and the hook denies', () => {
    const p = project();
    const refused = p.cli(['init', '--tools', 'none', '--roles', '--json'], { CLAUDECODE: '1' });
    expect(refused.code).not.toBe(0);
    expect(refused.json().status[0].code).toBe('agent_cannot_edit_roles');
    expect(fs.existsSync(p.roles)).toBe(false);
    expect(p.cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
    const hook = (command: string) => {
      const input = JSON.stringify({ cwd: p.root, tool_name: 'Bash', tool_input: { command } });
      const out = p.cli(['hook', 'pre-tool'], {}, input).stdout.trim();
      return out ? JSON.parse(out).hookSpecificOutput?.permissionDecision : 'allow';
    };
    expect(hook('sdlc init --tools none --roles')).toBe('deny');
    expect(hook('npx sdlc init --roles --tools claude')).toBe('deny');
    expect(hook('sdlc init --tools none')).not.toBe('deny');
  }, 180000);
});
