import { toDiagnostic } from '../core/errors.js';

const useColor = (): boolean =>
  !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

function wrap(code: number, reset: number) {
  return (text: string): string => (useColor() ? `\x1b[${code}m${text}\x1b[${reset}m` : text);
}

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
};

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function warn(text: string): void {
  process.stderr.write(`${c.yellow('warning')}: ${text}\n`);
}

/** Reports a failure in the requested mode and sets a non-zero exit code. */
export function reportFailure(error: unknown, json: boolean | undefined, nullShape: Record<string, unknown> = {}): void {
  const diagnostic = toDiagnostic(error);
  if (json) {
    printJson({ ...nullShape, status: [diagnostic] });
  } else {
    process.stderr.write(`${c.red('error')}: ${diagnostic.message}\n`);
    if (diagnostic.fix) process.stderr.write(`${c.dim('fix')}: ${diagnostic.fix}\n`);
  }
  process.exitCode = 1;
}

export function gateBadge(status: string): string {
  switch (status) {
    case 'approved':
    case 'passed':
      return c.green(`✓ ${status}`);
    case 'waived':
    case 'n/a':
      return c.dim(`~ ${status}`);
    case 'rejected':
    case 'failed':
      return c.red(`✗ ${status}`);
    case 'stale':
      return c.yellow(`↻ ${status}`);
    case 'pending':
      return c.yellow(`… ${status}`);
    default:
      return c.dim(`· ${status}`);
  }
}
