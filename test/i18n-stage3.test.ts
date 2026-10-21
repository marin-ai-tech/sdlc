import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { setLocale } from '../src/core/i18n.js';
import { REPO_ROOT, humanEnv, runCli, tempDir } from './helpers.js';

describe('English locale option descriptions', () => {
  it('keeps the JSON option description', async () => {
    const { buildProgram } = await import('../src/cli/index.js');
    setLocale('en');
    const verify = buildProgram().commands.find((command) => command.name() === 'verify')!;
    expect(verify.options.find((option) => option.long === '--json')?.description).toBe('output JSON');
  });

  it('documents how catalogs are installed at run time', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8');
    expect(guide).toMatch(/assets\/locales/);
    expect(guide).toMatch(/discovered at run time/);
    expect(guide).toMatch(/i18n|language/);
  });
  it('commander errors and per-command help follow the locale; English is unchanged', () => {
    const cwd = tempDir('sdlc-i18n3-');
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['approve'], cwd, env).stderr).toMatch(/error: missing required argument 'gate'/);
    expect(runCli(['approve', '--help'], cwd, env).stdout).toMatch(/^Usage: sdlc approve/m);
  });

  it('negative: under the English locale option descriptions stay exactly as written', async () => {
    const { buildProgram } = await import('../src/cli/index.js');
    setLocale('en');
    const verify = buildProgram().commands.find((c) => c.name() === 'verify')!;
    expect(verify.options.find((o) => o.long === '--json')?.description).toBe('output JSON');
  });
});
