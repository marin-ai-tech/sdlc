import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { HUMAN_COMMANDS } from '../src/core/human-commands.js';
import { secondLayerCommands, SECOND_LAYER_COMMANDS } from '../src/integrations/second-layer.js';
import { pluginProject } from './fixtures/plugin-project.js';
import { humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

function missingPackageProject() {
  const root = tempDir('sdlc-missing-rules-');
  const env = humanEnv(tempDir('sdlc-missing-rules-person-'));
  initGitRepo(root);
  const config = defaultConfig();
  config.tools = ['codex', 'qwen'];
  config.plugins = { economy: { enabled: true, package: 'private/DO-NOT-LEAK-package',
    digest: `sha256:${'0'.repeat(64)}`, config: {} } };
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(config)));
  write(path.join(root, '.codex/rules/person.rules'), '# PRIVATE-USER-CONTENT\n');
  write(path.join(root, '.agents/skills/person/SKILL.md'), '# Person skill\n');
  write(path.join(root, '.qwen/settings.json'), JSON.stringify({ theme: 'person-theme',
    permissions: { allow: ['Read'], deny: ['Bash(personal --keep *)'] } }));
  return { root, cli: (args: string[]) => runCli(args, root, env) };
}

function assertStaticRestrictions(root: string): void {
  const rules = read(path.join(root, '.codex/rules/sdlc.rules'));
  const qwen = JSON.parse(read(path.join(root, '.qwen/settings.json')));
  const bins = Object.keys(JSON.parse(read(path.join(REPO_ROOT, 'package.json'))).bin);
  const spellings = bins.flatMap((name) => [name, `${name}.cmd`]);
  expect(spellings).toHaveLength(4);
  for (const cli of spellings) {
    for (const command of [...HUMAN_COMMANDS, 'adopt --apply', 'init --roles']) {
      const pattern = [cli, ...command.split(' ')].map((word) => JSON.stringify(word)).join(', ');
      expect(rules).toContain(`pattern = [${pattern}]`);
      expect(qwen.permissions.deny).toContain(`Bash(${cli} ${command})`);
      expect(qwen.permissions.deny).toContain(`Bash(${cli} ${command} *)`);
    }
  }
  expect(read(path.join(root, '.codex/rules/person.rules'))).toBe('# PRIVATE-USER-CONTENT\n');
  expect(read(path.join(root, '.agents/skills/person/SKILL.md'))).toBe('# Person skill\n');
  expect(qwen.theme).toBe('person-theme');
  expect(qwen.permissions.allow).toEqual(['Read']);
  expect(qwen.permissions.deny).toContain('Bash(personal --keep *)');
}

describe('Static restrictions and owned dynamic refresh', () => {
  it.each(['init', 'update'])('actual %s writes every static denial with an enabled missing package', (command) => {
    const p = missingPackageProject();
    const started = performance.now();
    const args = command === 'init' ? ['init', '--tools', 'codex,qwen', '--layout', 'none', '--json']
      : ['update', '--tools', 'codex,qwen', '--json'];
    const result = p.cli(args);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json().tools).toEqual(['codex', 'qwen']);
    expect(result.stderr).toContain('Dynamic plugin restrictions are unavailable');
    expect(result.stderr).toContain('plugin_unavailable');
    expect(result.stderr).not.toContain('DO-NOT-LEAK-package');
    expect(result.stderr).not.toContain('PRIVATE-USER-CONTENT');
    expect(result.stderr).not.toContain(p.root);
    expect(performance.now() - started).toBeLessThan(90000);
    assertStaticRestrictions(p.root);
  }, 120000);

  it('keeps every static human restriction when the plugin catalog is broken', () => {
    const root = tempDir('sdlc-broken-rules-');
    const config = defaultConfig();
    config.plugins = { economy: { enabled: true, package: 'private/missing',
      digest: `sha256:${'0'.repeat(64)}`, config: {} } };
    expect(secondLayerCommands(root, config)).toEqual([...SECOND_LAYER_COMMANDS]);
  });

  it('actual accept/revoke refreshes only owned Codex and Qwen restrictions', async () => {
    const p = await pluginProject({ output: 'ok' }, {}, {}, false);
    p.raw.tools = ['codex', 'qwen'];
    fs.writeFileSync(p.file, stringify(p.raw));
    const initialized = p.cli(['init', '--tools', 'codex,qwen', '--layout', 'none', '--json']);
    expect(initialized.code, initialized.stdout + initialized.stderr).toBe(0);
    const codex = path.join(p.root, '.codex/rules/sdlc.rules');
    const qwen = path.join(p.root, '.qwen/settings.json');
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    expect(read(codex)).toContain('economy');
    expect(read(qwen)).toContain('economy configure');
    const revoked = p.cli(['plugins', 'revoke', 'economy', '--json']);
    expect(revoked.code, revoked.stdout + revoked.stderr).toBe(0);
    expect(read(codex)).not.toContain('economy');
    expect(read(qwen)).not.toContain('economy configure');
    expect(read(codex)).toContain('approve');
    expect(read(qwen)).toContain('approve');
    fs.appendFileSync(codex, '# person customization\n');
    const customized = read(codex);
    const again = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(read(codex)).toBe(customized);
    expect(read(qwen)).toContain('economy configure');
  }, 120000);
});
