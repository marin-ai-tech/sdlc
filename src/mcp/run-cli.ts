import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { harnessPackageDir } from '../core/openspec-schema.js';

/** How long one CLI command may run before the tool answers with an error. */
const CHILD_TIMEOUT_MS = 120_000;
/** The largest stdout a command may print (the JSON of a big project stays far below it). */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface CliRun {
  /** The child's exit code; undefined when it could not start or was killed. */
  code: number | undefined;
  stdout: string;
  stderr: string;
  /** Why the child did not run to its end (spawn error, timeout). */
  failure?: string;
}

/** This CLI's own entry script, so the child is the same harness version as the server. */
export function cliEntry(): string {
  return path.join(harnessPackageDir(), 'bin', 'sdlc.js');
}

/**
 * Runs `node <entry> <args...>` in the project directory with the server's environment and collects its output.
 * Never a shell: every argument reaches the CLI as one word. Never in-process: commands print to stdout, which is
 * the protocol channel of the server.
 */
export function runCli(args: string[], cwd: string, entry: string = cliEntry()): Promise<CliRun> {
  const options = {
    cwd,
    env: process.env,
    encoding: 'utf8' as const,
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  };
  return new Promise((resolve) => {
    execFile(process.execPath, [entry, ...args], options, (error, stdout, stderr) => {
      const failed = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      const code = failed ? (typeof failed.code === 'number' ? failed.code : undefined) : 0;
      const failure = failed && code === undefined ? failed.message : undefined;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ...(failure ? { failure } : {}) });
    });
  });
}
