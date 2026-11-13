import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { CI_GREEN, CI_PROVIDERS, CONFIRM_TOOLS, GITHUB_WORKFLOW, GITLAB_CI, GITLAB_INCLUDE, GITLAB_JOBS, ciGreenCheck, githubWorkflow, gitlabCi, gitlabJobs, includesJobs, } from '../core/ci-templates.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { humanCommandFix } from '../core/human-command.js';
import { t } from '../core/i18n.js';
import { harnessVersion } from '../core/version.js';
import { readYamlObject } from '../core/yaml-io.js';
import { updateYamlFile } from '../core/yaml-update.js';
const FILE_TEXT = {
    written: 'ci.file.written',
    replaced: 'ci.file.replaced',
    kept: 'ci.file.kept',
};
const CHECK_TEXT = { added: 'ci.check.added', kept: 'ci.check.kept' };
export function ciInitCommand(opts) {
    try {
        assertPerson();
        const provider = ciProvider(opts.provider);
        const ctx = loadProject();
        if (opts.check !== undefined)
            assertServer(ctx, opts.check);
        // sdlc.yaml first: if a CI file then fails to write, a rerun keeps the check (`kept`) and writes the file.
        const check = opts.check === undefined ? undefined : addCheck(ctx, provider, opts.check);
        const result = writeCi(ctx.root, provider, opts.force === true);
        if (check)
            result.check = check;
        print(result, opts.json);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function assertPerson() {
    if (!agentEnvironment())
        return;
    throw new SdlcError('agent_cannot_edit_ci', { key: 'error.only_a_person_may_write_ci_configuration' }, humanCommandFix('ci init'));
}
function ciProvider(value) {
    if (CI_PROVIDERS.includes(value ?? ''))
        return value;
    const params = { provider: String(value), providers: CI_PROVIDERS.join(', ') };
    throw new SdlcError('invalid_option', { key: 'error.ci_provider_x_must_be_x', params });
}
function assertServer(ctx, server) {
    const names = (ctx.config.mcp?.servers ?? []).map((item) => item.name);
    if (names.includes(server))
        return;
    throw new SdlcError('unknown_server', { key: 'error.ci_check_server_x_is_not_in_mcp_servers', params: { server, servers: names.join(', ') || '-' } }, { key: 'fix.ci_check_add_the_server_or_name_one_of_mcp_servers' });
}
function writeCi(root, provider, force) {
    const version = harnessVersion();
    if (provider === 'github') {
        return { provider, files: [writeTarget(root, GITHUB_WORKFLOW, githubWorkflow(version), force)] };
    }
    const files = [writeTarget(root, GITLAB_JOBS, gitlabJobs(version), force)];
    const include = gitlabInclude(root, files);
    return { provider, files, include };
}
/** Whether anything (a file, a folder, a link, even a broken one) is at `file`. */
function occupied(file) {
    try {
        fs.lstatSync(file);
        return true;
    }
    catch {
        return false;
    }
}
function writeTarget(root, rel, content, force) {
    const file = path.join(root, rel);
    const present = occupied(file);
    if (present && !force)
        return { path: rel, status: 'kept' };
    writeTextAtomic(file, content);
    return { path: rel, status: present ? 'replaced' : 'written' };
}
/** `.gitlab-ci.yml`: created with the include when there is none; an existing one is only read. */
function gitlabInclude(root, files) {
    const file = path.join(root, GITLAB_CI);
    if (!occupied(file)) {
        files.push(writeTarget(root, GITLAB_CI, gitlabCi(), false));
        return { file: GITLAB_CI, status: 'created' };
    }
    if (includesJobs(readText(file) ?? ''))
        return { file: GITLAB_CI, status: 'included' };
    return { file: GITLAB_CI, status: 'missing', mustInclude: GITLAB_JOBS, snippet: GITLAB_INCLUDE };
}
function isPlain(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Adds `ci-green` to verify.mcp through the config writer (comments and order stay), unless one exists. */
function addCheck(ctx, provider, server) {
    const file = ctx.paths.sdlcConfig;
    const raw = readYamlObject(file) ?? {};
    const verify = isPlain(raw.verify) ? raw.verify : {};
    const checks = Array.isArray(verify.mcp) ? verify.mcp : [];
    const existing = checks.find((check) => isPlain(check) && check.name === CI_GREEN);
    if (existing) {
        return { name: CI_GREEN, server: String(existing.server), status: 'kept', confirmWith: CONFIRM_TOOLS };
    }
    const next = [...checks, ciGreenCheck(provider, server)];
    updateYamlFile(file, { verify: { mcp: checks } }, { verify: { mcp: next } });
    return { name: CI_GREEN, server, status: 'added', confirmWith: CONFIRM_TOOLS };
}
function print(result, json) {
    if (json) {
        printJson(result);
        return;
    }
    for (const file of result.files)
        line(t(FILE_TEXT[file.status], { path: file.path }));
    if (result.include?.status === 'missing')
        printMissingInclude(result.include);
    if (result.check)
        printCheck(result.check);
}
function printMissingInclude(include) {
    line(t('ci.includeMissing', { file: include.file, jobs: include.mustInclude ?? GITLAB_JOBS }));
    line(`  ${include.snippet ?? GITLAB_INCLUDE}`);
}
function printCheck(check) {
    line(t(CHECK_TEXT[check.status], { name: check.name, server: check.server }));
    line(t('ci.check.confirm', { command: check.confirmWith }));
}
