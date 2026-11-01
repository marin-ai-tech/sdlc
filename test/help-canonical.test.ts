import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/index.js';
import { helpCatalog } from '../src/core/help-catalog.js';
import { setLocale } from '../src/core/i18n.js';
import { humanEnv, REPO_ROOT, runCli, tempDir } from './helpers.js';

describe('Canonical command descriptions and option contexts', () => {
  it('enumerates every real built-in command using its canonical English key', () => {
    const english = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'assets/locales/en.json'), 'utf8'));
    const commands = helpCatalog(buildProgram()).commands;
    for (const command of commands) {
      const key = `cmd.${command.name.replaceAll(' ', '.')}`;
      expect(english[key], key).toBeTypeOf('string');
      expect(command.description, key).toBe(english[key]);
    }
    expect(commands.find(item => item.name === 'gate read')?.description).toBe(english['cmd.gate.read']);
  });

  it('real JSON help is identical under locale contexts', () => {
    const root = tempDir('sdlc-help-locale-');
    const env = humanEnv(tempDir('sdlc-help-home-'));
    const a = runCli(['help', '--json', '--locale', 'en'], root, env);
    const b = runCli(['help', '--json', '--locale', 'zz'], root, env);
    expect(a.code, a.stderr).toBe(0);
    expect(b.code, b.stderr).toBe(0);
    expect(b.json()).toEqual(a.json());
    setLocale('en');
  });

  it('uses English descriptions with a genuinely installed alternative catalog', () => {
    const root = tempDir('sdlc-installed-locale-');
    for (const part of ['dist', 'bin', 'assets', 'schemas']) {
      fs.cpSync(path.join(REPO_ROOT, part), path.join(root, part), { recursive: true });
    }
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    const english = JSON.parse(fs.readFileSync(path.join(root, 'assets/locales/en.json'), 'utf8'));
    const alternate = Object.fromEntries(Object.entries(english).map(([key, value]) =>
      [key, key.startsWith('cmd.') ? `Alternative ${value}` : value]));
    fs.writeFileSync(path.join(root, 'assets/locales/zz.json'), JSON.stringify(alternate));
    const result = spawnSync(process.execPath, [path.join(root, 'bin/sdlc.js'), 'help', '--json', '--locale', 'zz'],
      { cwd: root, env: humanEnv(tempDir('sdlc-installed-locale-home-')), encoding: 'utf8', timeout: 30000 });
    expect(result.status, result.stderr).toBe(0);
    for (const command of JSON.parse(result.stdout).commands) {
      expect(command.description).toBe(english[`cmd.${command.name.replaceAll(' ', '.')}`]);
      expect(command.description).not.toMatch(/^Alternative /);
    }
  }, 40000);

  it('refuses --no-branches without --me before looking up a project', () => {
    const root = tempDir('sdlc-next-context-');
    const result = runCli(['next', '--no-branches', '--json'], root, humanEnv(root));
    expect(result.code).toBe(1);
    expect(result.json().status[0]).toMatchObject({ code: 'invalid_option' });
    expect(result.json().status[0].message).toContain('--no-branches requires --me');
  });
});
