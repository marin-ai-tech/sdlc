import type { Executor } from '../core/executors.js';
import { executorRefusal } from '../core/executors.js';
import { SdlcError } from '../core/errors.js';
import type { TaskItem } from '../core/task-contract.js';
import { HarnessRuntime, type HarnessSession } from './harness-runtime.js';

/** Host-side bridge: no credential, claim token or broker endpoint is serialized into an agent's task. */
export interface HarnessHost {
  /** Upload a credential-free repository/bundle and verify the installed sdlc hooks. */
  prepare(session: string, item: TaskItem): Promise<void>;
  /** Renew only while the runtime is active. A paused session stops renewing and its board lease expires. */
  heartbeat(): Promise<void>;
  /** Download/import into an isolated checkout; check trailers, forbidden paths, verify commands and fingerprint. */
  verify(session: string, item: TaskItem): Promise<{ branch: string; passed: boolean }>;
}

function refuse(detail: string): never {
  throw new SdlcError('harness_refused', { key: 'error.harnessProtocol', params: { detail } });
}

/** Prototype coordinator behind the existing executor and task contracts; it never decides a gate. */
export class HarnessAdapter {
  constructor(private runtime: HarnessRuntime, private host: HarnessHost) {}

  async dispatch(executor: Executor, item: TaskItem, configId: string): Promise<HarnessSession> {
    if (executor.type !== 'harness' || item.executor !== executor.id) refuse('executor mismatch');
    if (executorRefusal(executor, item.risk, item.kind)) refuse('executor permission');
    const session = await this.runtime.create(configId, `sdlc-${item.change}-${item.task.id.replace(/\./g, '-')}`);
    return session;
  }

  async launch(session: string, item: TaskItem): Promise<void> {
    const current = await this.runtime.get(session);
    if (current.status !== 'SESSION_STATUS_READY') refuse('session is not ready');
    const guard = await this.runtime.exec(session, ['sh', '-c', [
      'for name in DIGITALOCEAN_TOKEN DO_API_TOKEN GITHUB_TOKEN GH_TOKEN GIT_ASKPASS; do',
      '  if printenv "$name" >/dev/null 2>&1; then exit 71; fi',
      'done',
    ].join('\n')]);
    if (guard.exitCode !== 0) refuse('sandbox credential isolation');
    await this.host.heartbeat();
    await this.host.prepare(session, item);
    await this.host.heartbeat();
    await this.runtime.input(session, JSON.stringify(item));
  }

  async refresh(session: string): Promise<'active' | 'paused' | 'stopped'> {
    const current = await this.runtime.get(session);
    if (current.status === 'SESSION_STATUS_PAUSED') return 'paused';
    if (current.status !== 'SESSION_STATUS_READY') return 'stopped';
    await this.host.heartbeat();
    return 'active';
  }

  async fork(session: string, count: number, checkpoint?: string): Promise<HarnessSession[]> {
    return this.runtime.fork(session, count, checkpoint);
  }

  async candidates(sessions: string[], item: TaskItem): Promise<Array<{ session: string; branch: string }>> {
    const passed: Array<{ session: string; branch: string }> = [];
    for (const session of [...new Set(sessions)]) {
      const result = await this.host.verify(session, item);
      if (result.passed) passed.push({ session, branch: result.branch });
    }
    return passed;
  }
}
