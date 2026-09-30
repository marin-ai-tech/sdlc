import * as path from 'node:path';
import { git, humanEnv, initGitRepo, runCli, tempDir, write, type CliResult } from './helpers.js';

export const XSS_NOTE = '<script>alert(1)</script>';
export const XSS_REF = '<img src=x onerror=alert(2)>';

const INTENT = '# Intent: {name}\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

export interface ReportProject {
  root: string;
  cli(args: string[]): CliResult;
}

/**
 * An initialized project with two active changes:
 * - `say-hello`: intent approved (next: the agent writes the spec);
 * - `add-farewell`: intent rejected with a note carrying HTML (blocked), source ref carrying HTML.
 */
export function reportProject(): ReportProject {
  const root = tempDir('sdlc-report-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  const must = (args: string[]) => {
    const r = cli(args);
    if (r.code !== 0) throw new Error(`sdlc ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r;
  };
  initGitRepo(root);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  must(['init', '--tools', 'none', '--json']);

  must(['new', 'say-hello', '--kind', 'feature', '--risk', 'low', '--json']);
  write(path.join(root, 'openspec/changes/say-hello/intent.md'), INTENT.replace('{name}', 'say hello'));
  must(['approve', 'intent', '--change', 'say-hello', '--json']);

  must(['new', 'add-farewell', '--kind', 'feature', '--risk', 'low', '--source-type', 'ticket', '--source-ref', XSS_REF, '--json']);
  write(path.join(root, 'openspec/changes/add-farewell/intent.md'), INTENT.replace('{name}', 'add farewell'));
  must(['reject', 'intent', '--change', 'add-farewell', '--note', XSS_NOTE, '--json']);
  return { root, cli };
}
