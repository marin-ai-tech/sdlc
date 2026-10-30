import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Command } from 'commander';
import { registerPluginCommands } from '../dist/plugins/cli.js';
import { pluginHumanCommands } from '../dist/plugins/catalog.js';
import { callsNamedHumanCommand, callsPluginHumanCommand } from '../dist/core/human-command-match.js';
import { helpCatalog } from '../dist/core/help-catalog.js';
import { buildProgram } from '../dist/cli/index.js';
import { codexAdapter } from '../dist/integrations/codex.js';
import { renderContext } from '../dist/integrations/install.js';
import { mergeQwenSettings } from '../dist/integrations/qwen-settings.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { humanEnv, tempDir } from './helpers.js';

function dynamicCli(root: string, args: string[], agent = false) {
  const module = new URL('../dist/plugins/cli.js', import.meta.url).href;
  const commander = new URL('../node_modules/commander/esm.mjs', import.meta.url).href;
  const script = `import {Command} from ${JSON.stringify(commander)};
    import {registerPluginCommands} from ${JSON.stringify(module)};
    const program=new Command();registerPluginCommands(program);await program.parseAsync(process.argv.slice(2));`;
  const entry = path.join(tempDir('sdlc-plugin-cli-entry-'), 'cli.mjs');
  fs.writeFileSync(entry, script);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, env: humanEnv(tempDir('sdlc-plugin-cli-home-'), agent ? { SDLC_AGENT: 'test' } : {}),
    encoding: 'utf8', timeout: 10_000,
  });
  return { ...result, json: () => JSON.parse(result.stdout) };
}

describe('Plugin CLI and shared human surfaces', () => {
  it('Plugin command runs', async () => {
    const p = await pluginProject({ output: { answer: 42 } });
    const result = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'read', '--input-json', '[true,2]', '--json']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ plugin: 'economy', output: { answer: 42 } });
    const mutation = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'record', '--executor', 'mesh',
      '--request', pluginRequest(), '--input-json', '{}', '--json']);
    expect(mutation.status, mutation.stdout + mutation.stderr).toBe(0);
    expect(mutation.json()).toHaveProperty('transaction');
  });

  it('CLI and shell bypass attempts', async () => {
    const p = await pluginProject({ output: 1 });
    const result = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'configure', '--request', pluginRequest(), '--json'], true);
    expect(result.json().status[0].code).toBe('plugin_person_only');
    expect(pluginHumanCommands(p.root, p.config)).toEqual(['economy configure']);
    for (const command of ['sdlc economy configure',
      'sdlc.ps1 --locale=en economy `\n configure', 'node sdlc.js economy \\\n configure',
      'sdlc economy --locale en configure']) {
      expect(callsPluginHumanCommand(command, p.root, p.config), command).toBe(true);
    }
    expect(callsPluginHumanCommand('sdlc economy read', p.root, p.config)).toBe(false);
    expect(callsNamedHumanCommand('sdlc plugins --locale en accept economy', ['plugins accept'])).toBe(true);
    const store = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.revision).toBe(0);
  });

  it('Reserved or ambiguous name', async () => {
    const p = await pluginProject();
    const program = new Command();
    program.command('core').alias('economy');
    expect(() => registerPluginCommands(program, p.root)).toThrow(/collides/);
    expect(program.commands).toHaveLength(1);
  });

  it('Read tool returns a write through CLI', async () => {
    const p = await pluginProject({ output: 1, state: { changed: true } });
    const result = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'read', '--json']);
    expect(result.json().status[0].code).toBe('plugin_effect');
    const store = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.revision).toBe(0);
    expect(store.data).toEqual({});
  });

  it('direct configured command reports stale trust and reserved input without guest execution', async () => {
    const p = await pluginProject();
    const forged = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'read', '--input-json', '{"executor":"other"}', '--json']);
    expect(forged.json().status[0].code).toBe('plugin_input');
    expect(p.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
    const stale = dynamicCli(p.root, ['node', 'sdlc', 'economy', 'read', '--input-json', '{}', '--json']);
    expect(stale.stdout, stale.stderr).not.toBe('');
    expect(stale.json().status[0].code).toBe('plugin_unaccepted');
  });

  it('help and generated rules use current person descriptors and preserve personal Qwen rules', async () => {
    const p = await pluginProject();
    const program = buildProgram();
    registerPluginCommands(program, p.root);
    expect(helpCatalog(program, p.config).commands.find((item) => item.name === 'economy configure')?.actor).toBe('human');
    const rules = codexAdapter.render(renderContext(p.config, ['codex'], p.root))
      .find((item) => item.path === '.codex/rules/sdlc.rules')!.content;
    expect(rules).toContain('"sdlc", "economy", "configure"');
    const file = path.join(p.root, '.qwen/settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ permissions: { deny: ['Bash(personal *)', 'Bash(sdlc economy configure)'] } }));
    mergeQwenSettings(p.root, 'sdlc', 'qwen', true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny).toContain('Bash(sdlc economy configure *)');
    p.raw.plugins.economy.enabled = false;
    fs.writeFileSync(p.file, stringify(p.raw));
    mergeQwenSettings(p.root, 'sdlc', 'qwen', true);
    const deny = JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny;
    expect(deny).toContain('Bash(personal *)');
    expect(deny).toContain('Bash(sdlc economy configure)');
    expect(deny).not.toContain('Bash(sdlc economy configure *)');
    p.raw.plugins.economy.enabled = true;
    fs.writeFileSync(p.file, stringify(p.raw));
    mergeQwenSettings(p.root, 'sdlc', 'qwen', true);
    const personalDuplicate = JSON.parse(fs.readFileSync(file, 'utf8'));
    personalDuplicate.permissions.deny.push('Bash(sdlc economy configure *)');
    fs.writeFileSync(file, JSON.stringify(personalDuplicate));
    p.raw.plugins.economy.enabled = false;
    fs.writeFileSync(p.file, stringify(p.raw));
    mergeQwenSettings(p.root, 'sdlc', 'qwen', true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny
      .filter((rule: string) => rule === 'Bash(sdlc economy configure *)')).toHaveLength(1);
  });
});
