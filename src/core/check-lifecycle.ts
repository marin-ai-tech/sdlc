import { checkShell, cleanupCheckShell, type CheckShell } from './check-shell.js';
import { startOwnedCheck, type StartedCheck } from './check-startup.js';
import type { VerifyCommand } from './config.js';
import type { CheckOutcome } from './verify.js';

const CLEANUP_MS = 6500;
const PIPE_DRAIN_MS = 250;

export function runOwnedCheck(root: string, check: VerifyCommand, timeoutSeconds: number,
  outputLines: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    new CheckLifecycle(root, check, timeoutSeconds, outputLines, resolve).begin();
  });
}

class CheckLifecycle {
  private readonly started = Date.now();
  private readonly chunks: Buffer[] = [];
  private readonly handlers = new Map<NodeJS.Signals, () => void>();
  private size = 0;
  private prepared?: StartedCheck;
  private shell?: CheckShell;
  private ready = false;
  private finished = false;
  private timedOut = false;
  private cancelled?: 'SIGINT' | 'SIGTERM';
  private cleanupFailed = false;
  private knownExit: number | null | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private pipeTimer?: ReturnType<typeof setTimeout>;
  private stopping?: Promise<void>;

  constructor(private readonly root: string, private readonly check: VerifyCommand,
    private readonly timeoutSeconds: number, private readonly outputLines: number,
    private readonly resolve: (result: CheckOutcome) => void) {}

  begin(): void {
    try {
      this.prepared = startOwnedCheck(this.root, this.check);
      const child = this.prepared.child;
      this.shell = checkShell(child);
      child.stdout?.on('data', (chunk: Buffer) => this.keep(chunk));
      child.stderr?.on('data', (chunk: Buffer) => this.keep(chunk));
      child.on('exit', (code) => this.exited(code));
      child.on('close', () => this.closed());
      child.on('error', (error) => this.startupFailure(error));
      this.installSignals();
      this.prepared.ready.then(() => this.commandReady(), (error: unknown) => this.startupFailure(error));
    } catch (error) {
      this.startupFailure(error);
    }
  }

  private keep(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > 2 * 1024 * 1024 && this.chunks.length > 1) this.size -= this.chunks.shift()!.length;
  }

  private commandReady(): void {
    if (this.finished || this.stopping) return;
    this.ready = true;
    if (this.knownExit !== undefined) return;
    this.timer = setTimeout(() => {
      if (this.shell?.exited()) return;
      this.timedOut = true;
      this.stop();
    }, this.timeoutSeconds * 1000);
  }

  private exited(code: number | null): void {
    this.knownExit = code;
    clearTimeout(this.timer);
    if (this.finished || this.stopping) return;
    if (process.platform !== 'win32') {
      this.stop();
      return;
    }
    this.pipeTimer = setTimeout(() => this.stop(), PIPE_DRAIN_MS);
  }

  private closed(): void {
    if (this.finished || this.stopping || !this.ready || this.knownExit === undefined) return;
    this.finish(this.knownExit);
  }

  private startupFailure(error: unknown): void {
    if (this.finished) return;
    const message = error instanceof Error ? error.message : String(error);
    this.keep(Buffer.from(`\n${message}\n`));
    if (this.prepared?.child.pid && !this.shell?.exited()) {
      this.stop(1);
      return;
    }
    this.finish(1);
  }

  private stop(failureCode?: number): void {
    if (this.stopping || this.finished) return;
    clearTimeout(this.timer);
    this.cleanupTimer = setTimeout(() => {
      this.cleanupFailed = true;
      this.killHandle();
      this.keep(Buffer.from(`\nProcess tree cleanup exceeded its deadline. Limit: ${CLEANUP_MS} ms.\n`));
      this.closePipes();
      this.finish(failureCode ?? this.resultCode());
    }, CLEANUP_MS);
    const onFailure = () => {
      this.cleanupFailed = true;
      this.killHandle();
    };
    const cleanup = this.shell?.pid
      ? cleanupCheckShell(this.shell, (chunk) => this.keep(chunk), onFailure) : Promise.resolve();
    this.stopping = cleanup.finally(() => {
      this.closePipes();
      this.finish(failureCode ?? this.resultCode());
    });
  }

  private resultCode(): number | null {
    return this.timedOut ? null : this.knownExit ?? null;
  }

  private killHandle(): void {
    if (this.shell?.exited()) return;
    void this.shell?.kill().catch(() => {});
  }

  private installSignals(): void {
    if (process.platform === 'win32') return;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => this.cancel(signal);
      this.handlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  private cancel(signal: 'SIGINT' | 'SIGTERM'): void {
    if (this.finished) return;
    this.cancelled = signal;
    this.keep(Buffer.from(`\nVerification received ${signal}; cleaning up its owned process group.\n`));
    if (this.shell?.pid && !this.shell.exited()) {
      try {
        process.kill(-this.shell.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.keep(Buffer.from(`\n${String(error)}\n`));
      }
    }
    this.stop();
  }

  private closePipes(): void {
    this.prepared?.child.stdout?.destroy();
    this.prepared?.child.stderr?.destroy();
  }

  private finish(code: number | null): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    clearTimeout(this.cleanupTimer);
    clearTimeout(this.pipeTimer);
    for (const [signal, handler] of this.handlers) process.off(signal, handler);
    try {
      this.prepared?.dispose();
    } catch (error) {
      this.keep(Buffer.from(`\nVerification startup cleanup failed: ${String(error)}\n`));
    }
    this.resolve({ name: this.check.name, command: this.check.run, exit_code: code,
      duration_ms: Date.now() - this.started, required: this.check.required,
      ...(this.cancelled ? { cancelled: this.cancelled } : {}),
      ...(this.cleanupFailed ? { cleanup_failed: true } : {}),
      ...(this.timedOut ? { timed_out: true } : {}), output: outputTail(this.chunks, this.outputLines) });
  }
}

function outputTail(chunks: Buffer[], lines: number): string {
  const text = Buffer.concat(chunks).toString('utf8').replace(/\r\n?/g, '\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const all = text.split('\n');
  while (all.length && all[all.length - 1].trim() === '') all.pop();
  return all.slice(-lines).join('\n');
}
