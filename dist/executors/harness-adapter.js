import { executorRefusal } from '../core/executors.js';
import { SdlcError } from '../core/errors.js';
function refuse(detail) {
    throw new SdlcError('harness_refused', { key: 'error.harnessProtocol', params: { detail } });
}
const CREDENTIAL_PREFLIGHT = [
    'if [ "${DIGITALOCEAN_TOKEN+x}${DIGITALOCEAN_ACCESS_TOKEN+x}${DO_API_TOKEN+x}" ] ||',
    '   [ "${GITHUB_TOKEN+x}${GH_TOKEN+x}${GIT_ASKPASS+x}" ]; then',
    '  exit 71',
    'fi',
].join('\n');
/** Prototype coordinator behind the existing executor and task contracts; it never decides a gate. */
export class HarnessAdapter {
    runtime;
    host;
    constructor(runtime, host) {
        this.runtime = runtime;
        this.host = host;
    }
    async dispatch(executor, item, configId) {
        if (executor.type !== 'harness' || item.executor !== executor.id)
            refuse('executor mismatch');
        if (executorRefusal(executor, item.risk, item.kind))
            refuse('executor permission');
        const session = await this.runtime.create(configId, `sdlc-${item.change}-${item.task.id.replace(/\./g, '-')}`);
        return session;
    }
    async launch(session, item) {
        const current = await this.runtime.get(session);
        if (current.status !== 'SESSION_STATUS_READY')
            refuse('session is not ready');
        const guard = await this.runtime.exec(session, ['sh', '-c', CREDENTIAL_PREFLIGHT]);
        if (guard.exitCode !== 0)
            refuse('sandbox credential isolation');
        await this.host.heartbeat();
        await this.host.prepare(session, item);
        await this.host.heartbeat();
        await this.runtime.input(session, JSON.stringify(item));
    }
    async refresh(session) {
        const current = await this.runtime.get(session);
        if (current.status === 'SESSION_STATUS_PAUSED')
            return 'paused';
        if (current.status !== 'SESSION_STATUS_READY')
            return 'stopped';
        await this.host.heartbeat();
        return 'active';
    }
    async fork(session, count, checkpoint) {
        return this.runtime.fork(session, count, checkpoint);
    }
    async candidateReport(sessions, item) {
        const report = [];
        for (const session of [...new Set(sessions)]) {
            try {
                const result = await this.host.verify(session, item);
                const problems = !result.passed && !result.problems?.length
                    ? [{ code: 'harness_verification_failed' }] : result.problems;
                report.push({ session, ...result, ...(problems ? { problems } : {}) });
            }
            catch (error) {
                if (error instanceof SdlcError && error.code !== 'plugin_refused')
                    throw error;
                report.push({ session, branch: item.result.branch, passed: false,
                    problems: [{ code: error instanceof SdlcError ? error.code : 'harness_verification_failed' }] });
            }
        }
        return report;
    }
    async candidates(sessions, item) {
        const report = await this.candidateReport(sessions, item);
        return report.filter((result) => result.passed).map(({ session, branch }) => ({ session, branch }));
    }
}
