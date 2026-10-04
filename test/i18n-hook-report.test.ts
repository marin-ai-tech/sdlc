import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const CYRILLIC = /[а-яё]{3}/i;

function project() {
  const root = tempDir('sdlc-i18n2-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], more: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...more }, input);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  expect(cli(['new', 'add-x', '--json']).code).toBe(0);
  return { root, cli };
}

describe('hook reasons and reports in the locale', () => {
  it('a denied agent action explains itself in Russian with SDLC_LOCALE=ru; the decision itself does not change', () => {
    const { root, cli } = project();
    const input = JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command: 'sdlc approve review --change add-x' } });
    const ru = JSON.parse(cli(['hook', 'pre-tool'], { SDLC_LOCALE: 'ru' }, input).stdout).hookSpecificOutput;
    const en = JSON.parse(cli(['hook', 'pre-tool'], {}, input).stdout).hookSpecificOutput;
    expect(ru.permissionDecision).toBe('deny');
    expect(en.permissionDecision).toBe('deny');
    expect(ru.permissionDecisionReason).toMatch(CYRILLIC);
    expect(en.permissionDecisionReason).not.toMatch(CYRILLIC);
  });

  it('the session-start context is Russian for a Russian locale', () => {
    const { root, cli } = project();
    const out = cli(['hook', 'session-start'], { SDLC_LOCALE: 'ru' }, JSON.stringify({ cwd: root, source: 'startup' }));
    expect(JSON.parse(out.stdout).hookSpecificOutput.additionalContext).toMatch(CYRILLIC);
  });

  it('the dashboard and the Markdown report use the locale; the JSON report does not', () => {
    const { root, cli } = project();
    expect(cli(['dashboard', '--out', 'reports/ru.html', '--locale', 'ru']).code).toBe(0);
    const html = read(path.join(root, 'reports/ru.html'));
    expect(html).toMatch(/<html[^>]*lang="ru"/);
    expect(html).toMatch(CYRILLIC);
    expect(cli(['dashboard', '--out', 'reports/en.html']).code).toBe(0);
    expect(read(path.join(root, 'reports/en.html'))).toMatch(/<html[^>]*lang="en"/);
    expect(cli(['report', '--format', 'md', '--locale', 'ru']).stdout).toMatch(CYRILLIC);
    const json = (args: string[]) => {
      const out = cli([...args, '--json']).json<Record<string, unknown>>();
      delete out.generatedAt; // the run time, not the locale, differs between the two runs
      delete out.period;
      return JSON.stringify(out);
    };
    expect(json(['report', '--locale', 'ru'])).toBe(json(['report']));
  });
});
