import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write, type CliResult } from './helpers.js';

/**
 * Localization coverage: commands across the lifecycle run with --locale ru in a project whose own content
 * (titles, notes, artifacts) is Russian, so any English prose in the output comes from the CLI itself.
 */
const CYRILLIC = /[а-яё]/i;
const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'is', 'are', 'was', 'for', 'with', 'no', 'not', 'and',
  'or', 'in', 'on', 'at', 'by', 'be', 'has', 'have', 'must', 'will', 'can', 'this', 'that', 'it', 'run', 'use',
  'yet', 'from', 'into', 'than', 'only', 'none', 'already', 'cannot', 'does', 'do', 'should', 'would', 'there']);
/** Words of the CLI's own short messages ("Created change", "tests locked", "Would create"). */
const CLI_WORDS = new Set(['created', 'creating', 'change', 'changes', 'approved', 'rejected', 'waived', 'locked',
  'unlocked', 'written', 'installed', 'removed', 'kept', 'update', 'updated', 'remove', 'create', 'found', 'missing',
  'started', 'imported', 'archived', 'recorded', 'evidence', 'findings', 'finding', 'passed', 'failed', 'unknown',
  'invalid', 'valid', 'entries', 'tracked', 'edited', 'ready', 'item', 'items', 'epic', 'added', 'closed', 'done',
  'dropped', 'moved', 'next', 'start', 'checked', 'declared', 'license', 'project', 'person', 'agent', 'gate',
  'gates', 'approve', 'approval', 'approvals', 'review', 'verification', 'verify', 'checks', 'files', 'file',
  'initialized', 'harness', 'hooks', 'plugin', 'unchanged', 'left', 'untouched', 'blocked', 'pending', 'stale',
  'scenario', 'scenarios', 'row', 'aliases', 'documents', 'readiness', 'record', 'signing', 'signed', 'unsigned',
  'roles', 'role', 'people', 'refused', 'denied', 'not', 'here', 'name', 'path', 'warning', 'fix', 'run', 'set']);

/** True when a line still reads as English prose after names, paths, flags, code and URLs are removed. */
export function englishProse(line: string): boolean {
  if (CYRILLIC.test(line)) return false;
  if (/^\s*\$ /.test(line)) return false; // a command to copy
  if (/^\d{4}-\d\d-\d\dT[\d:.]+Z\s/.test(line)) return false; // a log record: stored data, English by design
  if (/[●○] ─ /.test(line)) return false; // the stepper: gate ids, which are names
  const stripped = line
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/(^|\s)--?[\w-]+/g, ' ')
    .replace(/\b[\w-]*\d[\w.-]*\b/g, ' ')
    .replace(/\b[a-z]+(?:-[a-z]+)+\b/g, ' ');
  const words = stripped.split(/[^A-Za-z']+/).filter(Boolean).map((w) => w.toLowerCase());
  for (let i = 0; i + 2 < words.length; i++) {
    const run = words.slice(i, i + 3);
    if (run.some((w) => FUNCTION_WORDS.has(w))) return true;
  }
  for (let i = 0; i + 1 < words.length; i++) {
    if (CLI_WORDS.has(words[i]) || CLI_WORDS.has(words[i + 1])) {
      if (/^[a-z']+$/.test(words[i]) && /^[a-z']+$/.test(words[i + 1])) return true;
    }
  }
  return false;
}

const INTENT = '# Замысел: экспорт\n\nАвтор: Пат. Статус: черновик. Источник: идея\n\n## Problem\nНужна выгрузка.\n\n## Proposed outcome\nКнопка выгрузки.\n\n## Affected users and systems\nВсе.\n\n## Constraints\nНет\n\n## Success measures\nВыгрузка работает.\n\n## Out of scope\nНет\n\n## Open questions\nНет\n';

function project() {
  const root = tempDir('sdlc-i18n-cov-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  // A Latin name: a Cyrillic one would hide English prose on the same line from the detector.
  git(root, ['config', 'user.name', 'Pat Lee']);
  git(root, ['config', 'user.email', 'pat@example.com']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'начало']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const offenders: string[] = [];
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string): CliResult => {
    const r = runCli([...args, '--locale', 'ru'], root, { ...env, ...extra }, input);
    for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
      if (englishProse(line)) offenders.push(`sdlc ${args.join(' ')} → ${line.trim()}`);
    }
    return r;
  };
  return { root, env, cli, offenders };
}

describe('the detector', () => {
  it('flags English prose and ignores names, paths, flags, code and Russian', () => {
    expect(englishProse('Created change add-x (sdlc schema, feature, risk medium, full track)')).toBe(true);
    expect(englishProse('No active change has an approved plan yet')).toBe(true);
    expect(englishProse('error: Unknown gate. Gates: intent, spec')).toBe(true);
    expect(englishProse('✓ tests locked for fix-x')).toBe(true);
    expect(englishProse('B1 Кнопка выгрузки')).toBe(false);
    expect(englishProse('add-x  [feature · risk medium · full track · schema sdlc]')).toBe(false);
    expect(englishProse('The intent gate was rejected by Pat')).toBe(true);
    expect(englishProse('Создано изменение add-x')).toBe(false);
    expect(englishProse('  openspec/changes/add-x/intent.md')).toBe(false);
    expect(englishProse('$ sdlc approve intent --change add-x --as product-owner')).toBe(false);
  });
});

describe('every command speaks the locale (stage 2)', () => {
  it('setup, health, layout and errors', () => {
    const { root, cli, offenders } = project();
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node -e ""' } }));
    cli(['init', '--tools', 'claude']);
    for (const args of [['doctor'], ['license'], ['layout', 'check'], ['layout', 'scaffold', '--dry-run'],
      ['layout', 'adapt', '--dry-run'], ['layout', 'convert'], ['update', '--dry-run'], ['uninstall', '--dry-run'],
      ['plugin', 'build', path.join(tempDir('sdlc-plugin-'), 'plugin')]]) cli(args);
    cli(['statusline'], {}, JSON.stringify({ cwd: root }));
    // errors and refusals
    cli(['status', '--change', 'nope']);
    cli(['approve', 'nogate', '--change', 'nope']);
    cli(['new', 'add-x']);
    cli(['new', 'add-x']);
    cli(['approve', 'intent', '--change', 'add-x'], { CLAUDECODE: '1' });
    cli(['backlog', 'start', 'B99']);
    cli(['import', 'bmad', 'missing-dir', '--to-backlog']);
    cli(['roles', 'who', 'review', '--change', 'add-x']);
    cli(['license', 'set', 'nonsense']);
    cli(['tests', 'unlock', '--change', 'add-x'], { CLAUDECODE: '1' });
    expect(offenders).toEqual([]);
  }, 300000);

  it('the lifecycle: changes, gates, verification, review, backlog, deferred work, roles, reports', () => {
    const { root, cli, offenders } = project();
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node -e ""' } }));
    cli(['init', '--tools', 'none']);
    cli(['explore', 'выгрузка']);
    cli(['explore', 'list']);
    cli(['backlog', 'epic', 'add', 'Выгрузка', '--goal', 'Пользователи выгружают данные']);
    cli(['backlog', 'add', 'Кнопка выгрузки', '--epic', 'E1', '--outcome', 'есть кнопка', '--accept', 'кнопка работает']);
    cli(['backlog', 'add', 'Формат CSV', '--epic', 'E1', '--outcome', 'csv', '--accept', 'файл открывается', '--depends', 'B1']);
    cli(['backlog', 'list']);
    cli(['backlog', 'next']);
    cli(['backlog', 'move', 'B2', '--top']);
    cli(['backlog', 'start', 'B1', '--change', 'add-export']);
    const dir = path.join(root, 'openspec/changes/add-export');
    write(path.join(dir, 'intent.md'), INTENT);
    cli(['approve', 'intent', '--change', 'add-export']);
    cli(['reject', 'intent', '--change', 'add-export', '--note', 'нужно уточнить']);
    cli(['approve', 'intent', '--change', 'add-export']);
    cli(['waive', 'release', '--change', 'add-export', '--note', 'внутреннее изменение']);
    cli(['new', 'fix-x', '--kind', 'bugfix', '--risk', 'low']);
    cli(['track', 'set', 'lite', '--change', 'fix-x', '--note', 'мелочь']);
    cli(['tests', 'lock', '--change', 'fix-x']);
    cli(['tests', 'unlock', '--change', 'fix-x']);
    cli(['verify', '--list']);
    cli(['verify', '--change', 'add-export']);
    cli(['verify', '--check', '--change', 'add-export']);
    cli(['validate', '--change', 'add-export']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    write(path.join(root, 'src/export.js'), 'export const run = () => 1;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'выгрузка']);
    cli(['review', 'context', '--change', 'add-export']);
    write(path.join(dir, 'review.md'), '# Ревью\n\n## Findings\n\n### F1 [nit][bugs] Мелочь\n- **Status**: fixed\n\n## Coverage\n- bugs: 1 finding\n- security: none found — checked: ввод\n- compliance: none found — checked: план\n- adversarial: none found — checked: большие файлы\n- edge-cases: none found — checked: пустые данные\n- verification-gaps: none found — checked: тесты\n');
    cli(['review', 'check', '--change', 'add-export']);
    cli(['defer', 'add', 'Выгрузка в XLSX', '--why', 'потом', '--change', 'add-export']);
    cli(['defer', 'list']);
    cli(['defer', 'close', 'D1', '--status', 'dropped', '--note', 'не нужно']);
    cli(['status']);
    cli(['next']);
    cli(['archive', 'add-export', '--yes', '--force', '--note', 'проверка вывода']);
    cli(['backlog', 'done', 'B2', '--note', 'готово']);
    cli(['backlog', 'drop', 'B2', '--note', 'не нужно']);
    cli(['audit']);
    cli(['log', '--limit', '5']);
    cli(['dashboard', '--out', 'reports/d.html']);
    cli(['import', 'bmad', 'missing', '--to-backlog', '--dry-run']);
    const config = path.join(root, 'openspec/sdlc.yaml');
    write(config, stringify({ ...parse(read(config)), roles: { 'code-owner': ['pat@example.com'] } }));
    cli(['roles', 'migrate']);
    cli(['roles', 'check']);
    cli(['roles', 'who', 'review', '--change', 'fix-x']);
    cli(['approvals', 'verify']);
    expect(offenders).toEqual([]);
  }, 600000);

  // About 40 CLI runs: well under a minute alone, past 120 s under a full parallel run.
  it('negative: JSON and error codes are the same in every locale', () => {
    const { root, env } = project();
    runCli(['init', '--tools', 'none', '--json'], root, env);
    runCli(['new', 'add-x', '--json'], root, env);
    const commands = [['status'], ['status', '--change', 'add-x'], ['backlog', 'list'], ['status', '--change', 'nope'],
      ['approve', 'nogate', '--change', 'add-x'], ['doctor'], ['license'], ['layout', 'check'], ['audit'],
      ['log'], ['verify', '--list'], ['defer', 'list'], ['explore', 'list'], ['next'], ['help'],
      ['update', '--dry-run'], ['uninstall', '--dry-run'], ['roles', 'check'], ['approvals', 'verify'],
      ['review', 'check', '--change', 'add-x'], ['report']];
    // Timestamps and durations differ between two runs, not between locales.
    const stable = (out: string) => out.replace(/"(generatedAt|until|ts|at|durationMs|duration_ms)": "?[^",\n]*"?/g, '"$1": 0');
    const leaks: string[] = [];
    for (const args of commands) {
      const en = stable(runCli([...args, '--json'], root, env).stdout);
      const ru = stable(runCli([...args, '--json', '--locale', 'ru'], root, env).stdout);
      if (ru !== en) leaks.push(args.join(' '));
    }
    expect(leaks).toEqual([]);
  }, 300000);
});

describe('roles, signatures and the change header speak the locale', () => {
  it('refusals by role, separation rules, signature states and the status header', () => {
    const { root, cli, offenders } = project();
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node -e ""' } }));
    cli(['init', '--tools', 'none']);
    write(path.join(root, 'openspec/roles.yaml'), ['version: 1', 'signing: warn', 'people:',
      '  pat: { name: Pat Lee, emails: [pat@example.com] }', '  kim: { name: Kim Park, emails: [kim@example.com] }',
      'roles:', '  product-owner: [kim]', '  engineer: [pat]', '  code-owner: [pat, kim]', '  maintainer: [kim]', ''].join('\n'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'роли']);
    cli(['new', 'add-x']);
    write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
    cli(['approve', 'intent', '--change', 'add-x']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    write(path.join(root, 'src/x.js'), 'export const x = 1;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'код']);
    cli(['roles', 'who', 'review', '--change', 'add-x', '--base', 'main']);
    cli(['roles', 'check', '--change', 'add-x', '--base', 'main']);
    cli(['approvals', 'verify']);
    const header = cli(['status', '--change', 'add-x']).stdout.split('\n')[0];
    expect(header).toMatch(/риск/);
    expect(offenders).toEqual([]);
  }, 300000);
});

describe('localization keeps the English meaning', () => {
  it('the community-license warning still says what is wrong, in English and in Russian', () => {
    const { root, env } = project();
    runCli(['init', '--tools', 'none', '--json'], root, env);
    const en = runCli(['license'], root, env).stdout;
    expect(en).toMatch(/community license, but the project declares no OSI-approved license/);
    const ru = runCli(['license', '--locale', 'ru'], root, env).stdout;
    expect(ru).toMatch(/OSI/);
    write(path.join(root, 'LICENSE'), 'Proprietary. All rights reserved.\n');
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'x', license: 'UNLICENSED' }));
    expect(runCli(['license'], root, env).stdout).toMatch(/community license, but the project's license .* is not OSI-approved/);
  }, 120000);
});
