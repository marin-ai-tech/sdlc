import { parse } from 'yaml';
/**
 * Starter CI configurations of `sdlc ci init` (B94, 0.17.0): a GitHub Actions workflow and a GitLab CI job that
 * install this sdlc version and run the sdlc checks on a full clone (`sdlc approvals verify` refuses a shallow one
 * since 0.16.3), and the `ci-green` check of verify.mcp that waits for the CI run of the commit (`${HEAD}`).
 * After the checks, also when one failed, `sdlc events flush` delivers the events queued in CI (B98).
 * Every file is built from an array of lines.
 */
export const CI_PROVIDERS = ['github', 'gitlab'];
export const GITHUB_WORKFLOW = '.github/workflows/sdlc.yml';
export const GITLAB_JOBS = '.gitlab/sdlc.yml';
export const GITLAB_CI = '.gitlab-ci.yml';
/** The line `.gitlab-ci.yml` needs so GitLab runs the sdlc job. */
export const GITLAB_INCLUDE = `include: [{ local: ${GITLAB_JOBS} }]`;
export const CI_GREEN = 'ci-green';
/** How the server's tool and argument names are confirmed (they are the server's own). */
export const CONFIRM_TOOLS = 'sdlc mcp check --args';
const HEAD_SHA = '${HEAD}';
const WAIT_SECONDS = 900;
/** The package of this sdlc version, as the release publishes it. */
export function packageUrl(version) {
    return `https://github.com/marin-ai-tech/sdlc/releases/download/v${version}/sdlc-${version}.tgz`;
}
function header(provider, version) {
    return `# sdlc checks, written by \`sdlc ci init --provider ${provider}\` (sdlc ${version}); --force rewrites it.`;
}
/** `.github/workflows/sdlc.yml`: one job, one comment line per step. */
export function githubWorkflow(version) {
    return [
        header('github', version),
        'name: sdlc',
        'on: [push, pull_request]',
        '# A read-only token: the checks only read the repository.',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  sdlc:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # The full history: sdlc approvals verify refuses a shallow clone.',
        '      - uses: actions/checkout@v4',
        '        with:',
        '          fetch-depth: 0',
        '      # Node.js 20 or newer runs the sdlc CLI.',
        '      - uses: actions/setup-node@v4',
        '        with:',
        "          node-version: '20'",
        '      # The sdlc version that wrote this file.',
        `      - run: npm install -g ${packageUrl(version)}`,
        '      # Changes and specs are valid.',
        '      - run: sdlc validate --all',
        '      # Approvals are in place (and signed where roles.yaml asks for it).',
        '      # With signing: off, this step checks no signatures.',
        '      - run: sdlc approvals verify',
        '      # Events queued here (a gate that waits for a person) reach the event sink, also when a check failed.',
        '      - if: always()',
        '        run: sdlc events flush',
        '',
    ].join('\n');
}
/** `.gitlab/sdlc.yml`: one job on a full clone (`GIT_DEPTH: "0"`), one comment line per step. */
export function gitlabJobs(version) {
    return [
        header('gitlab', version),
        `# ${GITLAB_CI} runs it with: ${GITLAB_INCLUDE}`,
        'sdlc:',
        '  # Node.js 20 or newer runs the sdlc CLI.',
        '  image: node:20',
        '  variables:',
        '    # The full history: sdlc approvals verify refuses a shallow clone.',
        '    GIT_DEPTH: "0"',
        '  script:',
        '    # The sdlc version that wrote this file.',
        `    - npm install -g ${packageUrl(version)}`,
        '    # Changes and specs are valid.',
        '    - sdlc validate --all',
        '    # Approvals are in place (and signed where roles.yaml asks for it).',
        '    # With signing: off, this step checks no signatures.',
        '    - sdlc approvals verify',
        '  # Events queued here reach the event sink; after_script runs also when a check failed (like when: always).',
        '  after_script:',
        '    - sdlc events flush',
        '',
    ].join('\n');
}
/** A new `.gitlab-ci.yml`: only the include of the sdlc job. */
export function gitlabCi() {
    return [
        `# GitLab CI of this project; the sdlc job is in ${GITLAB_JOBS} (written by \`sdlc ci init\`).`,
        GITLAB_INCLUDE,
        '',
    ].join('\n');
}
function includeTarget(item) {
    const value = typeof item === 'object' && item !== null ? item.local : item;
    return typeof value === 'string' ? value.replace(/^\.?\//, '') : undefined;
}
/** Whether a `.gitlab-ci.yml` text already includes the sdlc job (`include:` as a string, a list or a mapping). */
export function includesJobs(text) {
    let parsed;
    try {
        parsed = parse(text);
    }
    catch {
        return false;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return false;
    const include = parsed.include;
    const items = Array.isArray(include) ? include : [include];
    return items.some((item) => includeTarget(item) === GITLAB_JOBS);
}
/** GitHub: the runs of the commit's workflows (`list_workflow_runs` answers `{ workflow_runs: [...] }`). */
function githubCheck(server) {
    return {
        name: CI_GREEN,
        server,
        tool: 'list_workflow_runs',
        args: { head_sha: HEAD_SHA, per_page: 5 },
        expect: { workflow_runs: { $any: { conclusion: 'success' } } },
        wait_while: { workflow_runs: { $any: { status: ['queued', 'in_progress'] } } },
        wait_seconds: WAIT_SECONDS,
    };
}
/** GitLab: the commit's pipelines (`list_pipelines` answers a top-level list; `$any` at the top matches it). */
function gitlabCheck(server) {
    return {
        name: CI_GREEN,
        server,
        tool: 'list_pipelines',
        args: { sha: HEAD_SHA },
        expect: { $any: { status: 'success' } },
        wait_while: { $any: { status: ['created', 'pending', 'running'] } },
        wait_seconds: WAIT_SECONDS,
    };
}
/** The `ci-green` check of verify.mcp, in the on-disk (snake_case) form. */
export function ciGreenCheck(provider, server) {
    return provider === 'github' ? githubCheck(server) : gitlabCheck(server);
}
