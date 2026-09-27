import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(REPO_ROOT, 'bin', 'sdlc.js');

const AGENT_VARS = ['CLAUDECODE', 'OPENCODE', 'AGENT', 'SDLC_AGENT', 'CLAUDE_PROJECT_DIR'];

export function tempDir(prefix = 'sdlc-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Environment for a person at a terminal (no agent markers), isolated from the user's OpenSpec data. */
export function humanEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of AGENT_VARS) delete env[key];
  return {
    ...env,
    OPENSPEC_TELEMETRY: '0',
    OPENSPEC_NO_UPDATE_CHECK: '1',
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    NO_COLOR: '1',
    ...extra,
  };
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json<T = any>(): T;
}

export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string): CliResult {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', input, maxBuffer: 32 * 1024 * 1024 });
  return {
    code: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    json<T>() {
      return JSON.parse(r.stdout) as T;
    },
  };
}

export function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

export function initGitRepo(dir: string): void {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'Pat Owner']);
  git(dir, ['config', 'user.email', 'pat@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

export function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}
