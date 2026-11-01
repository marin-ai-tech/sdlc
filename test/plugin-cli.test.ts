import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Command } from 'commander';
import { registerPluginCommands } from '../dist/plugins/cli.js';
import { pluginHumanCommands } from '../dist/plugins/catalog.js';
import { callsNamedHumanCommand, callsPluginHumanCommand } from '../dist/core/human-command-match.js';
import { shellWords } from '../dist/core/shell-words.js';
import { defaultConfig } from '../dist/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../dist/core/policy.js';
import { projectPaths } from '../dist/core/project.js';
import { helpCatalog } from '../dist/core/help-catalog.js';
import { buildProgram } from '../dist/cli/index.js';
import { codexAdapter } from '../dist/integrations/codex.js';
import { renderContext } from '../dist/integrations/install.js';
import { mergeQwenSettings } from '../dist/integrations/qwen-settings.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { humanEnv, tempDir } from './helpers.js';

const packageInfo = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const supportedAlias = Object.keys(packageInfo.bin).find(name => name !== packageInfo.name);
if (!supportedAlias) throw new Error('The package must retain a supported compatibility command alias.');

function staticShellDecision(command: string) {
  const root = tempDir('sdlc-quoted-dynamic-');
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Static plugin command continuation boundaries', () => {
  it.each([
    { label: 'PowerShell LF', command: 'sdlc.ps1 --locale=en economy `\n configure',
      words: ['sdlc.ps1', '--locale=en', 'economy', 'configure'] },
    { label: 'PowerShell CRLF', command: 'sdlc.cmd --locale en economy `\r\n configure',
      words: ['sdlc.cmd', '--locale', 'en', 'economy', 'configure'] },
    { label: 'POSIX LF', command: 'node sdlc.js economy \\\n configure',
      words: ['node', 'sdlc.js', 'economy', 'configure'] },
    { label: 'POSIX CRLF', command: `npx --no-install ${supportedAlias} economy \\\r\n configure`,
      words: ['npx', '--no-install', supportedAlias, 'economy', 'configure'] },
    { label: 'repeated standalone joins', command: 'sdlc economy `\n \\\n configure',
      words: ['sdlc', 'economy', 'configure'] },
    { label: 'ambiguous paired midword backticks', command: 'sdlc eco`\nnomy con`\nfigure',
      words: ['sdlc', 'economy', 'configure'], dynamic: true },
    { label: 'ambiguous quoted PowerShell CRLF', command: 'sdlc "eco`\r\nnomy" "con`\r\nfigure"',
      words: ['sdlc', 'economy', 'configure'], dynamic: true },
  ])('decodes $label without synthetic arguments', ({ command, words, dynamic }) => {
    const parsed = shellWords(command);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.commands[0].words.map(word => word.value)).toEqual(words);
    expect(parsed.commands[0].words.some(word => word.dynamic)).toBe(dynamic ?? false);
    expect(parsed.commands[0].raw).toBe(command);
    expect(callsNamedHumanCommand(command, ['economy configure'])).toBe(true);
  });

  it('a standalone continuation without any command creates no word or command', () => {
    expect(shellWords('`\r\n \\\n').commands).toEqual([]);
  });

  it('denies paired POSIX command substitution when its backticks adjoin newlines', () => {
    const root = tempDir('sdlc-paired-substitution-');
    const config = defaultConfig();
    config.enforcement.mode = 'block';
    config.enforcement.requireApprovedPlan = false;
    const command = "sdlc `\nprintf 'approve plan --change x'`\n";
    expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root),
      { paths: projectPaths(root), config })).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    { label: 'inline POSIX substitution', quoted: '"ap`printf prov`e"', decoded: 'apprintf prove' },
    { label: 'LF POSIX substitution', quoted: '"ap`\nprintf prov`e"', decoded: 'apprintf prove' },
    { label: 'CMD percent expansion', quoted: '"ap%E20_QUOTED_PROBE%e"', decoded: 'ap%E20_QUOTED_PROBE%e' },
  ])('denies double-quoted $label without expanding argv', ({ quoted, decoded }) => {
    const command = `sdlc ${quoted} plan --change x`;
    const parsed = shellWords(command);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.commands[0].words.map(word => word.value)).toEqual(['sdlc', decoded, 'plan', '--change', 'x']);
    const word = parsed.commands[0].words[1];
    expect(command.slice(word.start, word.end)).toBe(quoted);
    expect(parsed.commands[0].raw).toBe(command);
    expect.soft(word.dynamic).toBe(true);
    expect(staticShellDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    { label: 'LF person decision', command: 'sdlc "ap`\nprove" plan --change x',
      words: ['sdlc', 'approve', 'plan', '--change', 'x'], rule: 'separation-of-duties' },
    { label: 'CRLF person decision', command: 'sdlc "ap`\r\nprove" plan --change x',
      words: ['sdlc', 'approve', 'plan', '--change', 'x'], rule: 'separation-of-duties' },
    { label: 'LF read', command: 'sdlc "sta`\ntus" --change x', words: ['sdlc', 'status', '--change', 'x'] },
    { label: 'CRLF read', command: 'sdlc "sta`\r\ntus" --change x', words: ['sdlc', 'status', '--change', 'x'] },
    { label: 'LF help', command: 'sdlc "ap`\nprove" plan --help', words: ['sdlc', 'approve', 'plan', '--help'] },
    { label: 'CRLF help', command: 'sdlc "ap`\r\nprove" plan --help', words: ['sdlc', 'approve', 'plan', '--help'] },
  ])('keeps an unpaired quoted PowerShell $label static', ({ command, words, rule }) => {
    const parsed = shellWords(command);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.commands[0].words.map(word => word.value)).toEqual(words);
    expect(parsed.commands[0].words.some(word => word.dynamic)).toBe(false);
    expect(parsed.commands[0].raw).toBe(command);
    expect(staticShellDecision(command)).toEqual(rule
      ? expect.objectContaining({ decision: 'deny', rule }) : { decision: 'allow' });
  });

  it.each(['ap`printf prov`e', 'ap%E20_QUOTED_PROBE%e'])('keeps single-quoted data literal: %s', literal => {
    const command = `printf '%s' '${literal}'`;
    const parsed = shellWords(command);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.commands[0].words.map(word => word.value)).toEqual(['printf', '%s', literal]);
    expect(parsed.commands[0].words.some(word => word.dynamic)).toBe(false);
    expect(parsed.commands[0].raw).toBe(command);
    expect(staticShellDecision(command)).toEqual({ decision: 'allow' });
  });

  it('retains Windows literal path values and spans before a physical newline', () => {
    const command = 'Copy-Item C:\\work\\\r\nnext';
    const parsed = shellWords(command);
    const file = parsed.commands[0].words[1];
    expect(file.value).toBe('C:\\work\\');
    expect(command.slice(file.start, file.end)).toBe('C:\\work\\');
    expect(parsed.commands[1].words[0].value).toBe('next');
  });

  it.each([
    'sdlc economy `\n read',
    'sdlc economy `\n configure --help',
    'echo "sdlc economy configure"',
    "printf '%s' 'sdlc economy configure'",
  ])('keeps read/help/quoted-data control: %s', command => {
    expect(callsNamedHumanCommand(command, ['economy configure'])).toBe(false);
  });

  it.each(['""', "''"])('retains an explicit empty quoted argument %s', quoted => {
    const command = `sdlc economy ${quoted} configure`;
    expect(shellWords(command).commands[0].words.map(word => word.value))
      .toEqual(['sdlc', 'economy', '', 'configure']);
    expect(callsNamedHumanCommand(command, ['economy configure'])).toBe(false);
  });
});

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
