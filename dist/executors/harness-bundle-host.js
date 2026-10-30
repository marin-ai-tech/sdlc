import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { heartbeatClaim } from '../core/board.js';
import { readBoard } from '../core/board-store.js';
import { SdlcError } from '../core/errors.js';
import { isWithin } from '../core/fs-utils.js';
import { git } from '../core/git.js';
import { FINGERPRINT_EXCLUDES } from '../core/lifecycle.js';
import { exportItems } from '../core/task-contract.js';
import { checkResult, checkResultCore } from '../core/task-result.js';
import { runPrepared } from '../plugins/evaluation.js';
import { cliActor } from '../plugins/broker.js';
import { canonical, LIMITS } from '../plugins/api.js';
import { candidatePassed } from './harness-validation.js';
const MAX_BUNDLE = 512 * 1024;
const WORKSPACE = '/workspace/project';
const OBSERVATIONS = ['openspec/.sdlc/log.jsonl', 'openspec/.sdlc/hook-log.jsonl'];
function refused(detail, code = 'harness_refused') {
    throw new SdlcError(code, { key: 'error.harnessProtocol', params: { detail } });
}
function itemIdentity(item) {
    const { ext, ...base } = item;
    return JSON.stringify(base) + (ext === undefined ? '' : canonical(ext, LIMITS.extBytes));
}
function failed(branch, problems) {
    return { branch, passed: false, problems };
}
function requiredGit(root, args) {
    const result = git(root, args);
    if (!result.ok)
        refused('host git operation failed');
    return result.stdout;
}
/** Small-repository prototype: git bundles cross the API; host credentials and board claim ids never do. */
export class HarnessBundleHost {
    options;
    constructor(options) {
        this.options = options;
    }
    async assertSource(item) {
        const { root, ref, config, claim, tool } = this.options;
        if (itemIdentity(item) !== itemIdentity(claim.item) || item.executor !== claim.claim.executor) {
            refused('claim mismatch');
        }
        const currentClaim = readBoard(root).claims.find((entry) => entry.id === claim.claim.id);
        if (!currentClaim || currentClaim.state !== 'held' || currentClaim.executor !== item.executor
            || currentClaim.item !== item.id || Date.parse(currentClaim.expiresAt) <= Date.now()) {
            refused('claim is not active');
        }
        if (canonical(currentClaim.ext ?? null, LIMITS.extBytes) !== canonical(item.ext ?? null, LIMITS.extBytes)) {
            refused('claim extension mismatch');
        }
        const dirty = requiredGit(root, ['status', '--porcelain', '--untracked-files=normal', '--', '.',
            ...OBSERVATIONS.map((file) => `:(exclude)${file}`)]);
        if (dirty || !item.base.commit)
            refused('commit the source and process records first');
        if (!config.tools.includes(tool) || config.enforcement.mode !== 'block'
            || !config.enforcement.forbidAgentApprovals)
            refused('source requires installed blocking agent hooks');
        if (requiredGit(root, ['rev-parse', 'HEAD']) !== item.base.commit)
            refused('source base changed');
        const hooks = tool === 'codex' ? '.codex/hooks.json' : '.claude/settings.json';
        requiredGit(root, ['ls-files', '--error-unmatch', 'openspec/sdlc.yaml', hooks,
            `openspec/changes/${ref.id}/.sdlc.yaml`]);
        const current = (await runPrepared(root, config, { operation: 'export', board: false,
            args: { change: ref.id, task: item.task.id, executor: item.executor, ext: item.ext }, actor: cliActor(root, item.executor) }, () => exportItems(root, ref, config, item.task.id, item.executor, item.ext))).items[0];
        if (!current || current.id !== item.id)
            refused('task is no longer open');
    }
    async checkedExec(session, argv, stdin = '', workdir = '/workspace') {
        const result = await this.options.runtime.exec(session, argv, stdin, workdir);
        if (result.exitCode !== 0)
            refused('sandbox preparation failed');
        return result.stdout;
    }
    async prepare(session, item) {
        await this.assertSource(item);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-harness-input-'));
        try {
            const file = path.join(directory, 'input.bundle');
            requiredGit(this.options.root, ['bundle', 'create', file, 'HEAD']);
            const bundle = fs.readFileSync(file);
            if (bundle.length > MAX_BUNDLE)
                refused('prototype input bundle exceeds 512 KiB');
            await this.checkedExec(session, ['node', '-e', [
                    "const fs=require('fs');",
                    "fs.writeFileSync(process.argv[1],Buffer.from(fs.readFileSync(0,'utf8'),'base64'));",
                ].join(''), '/workspace/input.bundle'], bundle.toString('base64'));
            await this.prepareRepository(session, item);
        }
        finally {
            fs.rmSync(path.join(directory, 'input.bundle'), { force: true });
            fs.rmdirSync(directory);
        }
    }
    async prepareRepository(session, item) {
        const exists = await this.checkedExec(session, ['node', '-e', "process.stdout.write(String(require('fs').existsSync(process.argv[1])))", `${WORKSPACE}/.git`]);
        if (exists === 'false') {
            await this.checkedExec(session, ['git', 'clone', '--no-checkout', '/workspace/input.bundle', WORKSPACE]);
            await this.checkedExec(session, ['git', '-C', WORKSPACE, 'switch', '-c', item.result.branch, item.base.commit]);
        }
        else {
            const head = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'rev-parse', 'HEAD']);
            const dirty = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'status', '--porcelain']);
            const branch = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'symbolic-ref', '--short', 'HEAD']);
            if (head.trim() !== item.base.commit || dirty.trim() || branch.trim() !== item.result.branch) {
                refused('warm workspace is not the approved clean task branch');
            }
        }
        const hooks = this.options.tool === 'codex' ? '.codex/hooks.json' : '.claude/settings.json';
        await this.checkedExec(session, ['node', '-e',
            "if(!require('fs').existsSync(process.argv[1]))process.exit(73)", `${WORKSPACE}/${hooks}`]);
        await this.checkedExec(session, ['sdlc', 'doctor', '--json'], '', WORKSPACE);
    }
    async heartbeat() {
        const { root, config, claim } = this.options;
        await runPrepared(root, config, { operation: 'heartbeat', board: true,
            args: { claim: claim.claim.id, executor: claim.claim.executor }, actor: cliActor(root, claim.claim.executor) }, () => heartbeatClaim(root, config, claim.claim.id, claim.claim.executor));
    }
    async verify(session, item) {
        if (!this.options.validateCandidate) {
            refused('isolated candidate validator is required', 'harness_validator_missing');
        }
        await this.assertSource(item);
        const { runtime, root, ref, config } = this.options;
        const branch = `refs/sdlc/harness/${randomUUID()}`;
        const made = await runtime.exec(session, ['git', '-C', WORKSPACE, 'bundle', 'create', '/workspace/result.bundle', item.result.branch,
            `^${item.base.commit}`]);
        if (made.exitCode !== 0)
            return failed(branch, [{ code: 'harness_bundle_failed' }]);
        const encoded = await this.checkedExec(session, ['node', '-e', [
                "const b=require('fs').readFileSync(process.argv[1]);",
                `if(b.length>${MAX_BUNDLE})process.exit(72);`,
                "process.stdout.write(b.toString('base64'));",
            ].join(''), '/workspace/result.bundle']);
        if (encoded.length > Math.ceil(MAX_BUNDLE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
            refused('invalid candidate bundle', 'harness_bundle_invalid');
        }
        return this.inspectBundle(Buffer.from(encoded, 'base64'), item, branch, root, ref, config);
    }
    async inspectBundle(bundle, item, branch, root, ref, config) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-harness-result-'));
        const file = path.join(directory, 'result.bundle');
        try {
            fs.writeFileSync(file, bundle);
            requiredGit(root, ['bundle', 'verify', file]);
            requiredGit(root, ['fetch', '--no-tags', '--no-write-fetch-head', file, `${item.result.branch}:${branch}`]);
            if (!git(root, ['merge-base', '--is-ancestor', item.base.commit, branch]).ok) {
                return failed(branch, [{ code: 'harness_ancestry' }]);
            }
            const head = requiredGit(root, ['rev-parse', '--verify', `${branch}^{commit}`]);
            const checked = checkResultCore(root, ref, config, head, item.base.commit, item.executor);
            const identities = checked.commits.filter((commit) => commit.change !== item.change
                || commit.task !== item.task.id || commit.agent !== item.result.trailers['SDLC-Agent'])
                .map((commit) => ({ code: 'harness_identity', sha: commit.sha }));
            const problems = [...checked.problems, ...identities];
            if (problems.length)
                return failed(branch, problems);
            if (!checked.ok)
                return failed(branch, [{ code: 'harness_core_failed' }]);
            if ((config.verify.mcp?.length ?? 0) > 0) {
                return failed(branch, [{ code: 'harness_verification_mcp' }]);
            }
            const validation = await this.validateBundle(directory, branch, config, head);
            if (validation.length)
                return failed(branch, validation);
            return this.consumeCandidate(branch, item, head);
        }
        finally {
            const safe = isWithin(os.tmpdir(), directory) && !fs.lstatSync(directory).isSymbolicLink()
                && fs.realpathSync(directory) === directory;
            if (safe) {
                fs.rmSync(file, { force: true });
                fs.rmSync(path.join(directory, 'validation.bundle'), { force: true });
                fs.rmSync(path.join(directory, 'validation.index'), { force: true });
                fs.rmSync(path.join(directory, 'validation.index.lock'), { force: true });
                fs.rmdirSync(directory);
            }
        }
    }
    /** Final plugin consumption must remain after ancestry, exact identity, core and isolated validation. */
    async consumeCandidate(branch, item, expectedHead) {
        await this.assertSource(item);
        const { root, ref, config } = this.options;
        const checked = await runPrepared(root, config, { operation: 'result', board: false,
            args: { change: ref.id, branch, base: item.base.commit, executor: item.executor }, actor: cliActor(root, item.executor) }, () => {
            if (requiredGit(root, ['rev-parse', '--verify', `${branch}^{commit}`]) !== expectedHead)
                refused('validated candidate changed');
            return checkResult(root, ref, config, branch, item.base.commit, item.executor);
        });
        return checked.ok ? { branch, passed: true } : failed(branch, checked.problems);
    }
    async validateBundle(directory, branch, config, expectedHead) {
        const commit = requiredGit(this.options.root, ['rev-parse', '--verify', `${branch}^{commit}`]);
        if (commit !== expectedHead)
            return [{ code: 'harness_candidate_changed' }];
        const file = path.join(directory, 'validation.bundle');
        requiredGit(this.options.root, ['bundle', 'create', file, branch]);
        const bundle = fs.readFileSync(file);
        if (bundle.length > MAX_BUNDLE)
            refused('prototype validation bundle exceeds 512 KiB');
        const fingerprint = this.candidateFingerprint(directory, commit);
        const verification = structuredClone(config.verify);
        let evidence;
        try {
            evidence = await this.options.validateCandidate({
                bundle, ref: branch, commit, verification: structuredClone(verification),
            });
        }
        catch {
            return [{ code: 'harness_validator_unavailable' }];
        }
        return candidatePassed(evidence, commit, verification, fingerprint)
            ? [] : [{ code: 'harness_validator_failed' }];
    }
    candidateFingerprint(directory, commit) {
        const top = requiredGit(this.options.root, ['rev-parse', '--show-toplevel']);
        const prefix = requiredGit(this.options.root, ['rev-parse', '--show-prefix']);
        const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, 'validation.index') };
        const run = (args) => spawnSync('git', args, { cwd: top, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (run(['read-tree', commit]).status !== 0)
            refused('candidate fingerprint unavailable');
        for (const excluded of FINGERPRINT_EXCLUDES) {
            if (run(['--literal-pathspecs', 'rm', '-r', '--cached', '-q', '--ignore-unmatch', '--',
                `${prefix}${excluded}`]).status !== 0)
                refused('candidate fingerprint unavailable');
        }
        const tree = run(['write-tree']);
        if (tree.status !== 0 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(tree.stdout.trim())) {
            refused('candidate fingerprint unavailable');
        }
        return `git-tree:${tree.stdout.trim()}`;
    }
}
