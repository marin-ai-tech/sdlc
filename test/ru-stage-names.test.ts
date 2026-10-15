import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * The owner's rule (2026-10-15): in Russian the names of the stages (plan, design, build, test, deploy, maintain) and
 * of the gates (intent, spec, plan, verify, qa, review, release) are not translated; they stay as the English
 * identifiers. The Russian CLI messages and the built-in Russian guide follow it: a stage title reads as in English
 * ("Plan (intent)"), a gate is "гейт intent", a chain of stages is "intent → spec".
 */

const STAGES = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'];

function catalog(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `assets/locales/${locale}.json`), 'utf8'));
}

describe('stage and gate names stay English in Russian', () => {
  it('a Russian stage title starts with the English stage name; its gates are named in English', () => {
    const ru = catalog('ru');
    const gates: Record<string, string[]> = {
      plan: ['intent'], design: ['spec'], build: ['plan'], test: ['verify'], deploy: ['review', 'release'], maintain: [],
    };
    for (const stage of STAGES) {
      const title = ru[`stage.${stage}`];
      const name = stage[0].toUpperCase() + stage.slice(1);
      expect(title, stage).toMatch(new RegExp(`^${name}\\b`));
      for (const gate of gates[stage]) expect(title, stage).toContain(gate);
    }
    expect(ru['stage.plan']).toBe('Plan (intent)');
  });

  it('no Russian message or guide page translates a stage or a gate name', () => {
    const check = spawnSync(process.execPath,
      [path.join(REPO_ROOT, 'scripts/check-ru-stage-names.mjs'), 'assets/locales/ru.json', 'assets/guide/ru'],
      { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(check.status, check.stdout).toBe(0);
  });

  it('sdlc status in Russian names the stage in English', () => {
    const root = tempDir('sdlc-ru-stage-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'), { SDLC_LOCALE: 'ru' });
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'add-export', '--json'], root, env).code).toBe(0);
    const status = runCli(['status', '--change', 'add-export'], root, env).stdout;
    expect(status).toContain('Plan (intent)');
    expect(status).not.toMatch(/План \(замысел\)/);
  }, 120000);
});
