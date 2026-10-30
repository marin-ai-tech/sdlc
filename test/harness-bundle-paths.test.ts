import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { claimTask } from '../src/core/board.js';
import { resolveChange } from '../src/core/changes.js';
import { loadConfig } from '../src/core/config.js';
import { worktreeFingerprint } from '../src/core/git.js';
import { FINGERPRINT_EXCLUDES } from '../src/core/lifecycle.js';
import { projectPaths } from '../src/core/project.js';
import * as verification from '../src/core/verify.js';
import * as taskResult from '../src/core/task-result.js';
import { HarnessBundleHost } from '../src/executors/harness-bundle-host.js';
import type { HarnessRuntime } from '../src/executors/harness-runtime.js';
import type { HarnessValidationRequest } from '../src/executors/harness-validation.js';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B151 (review finding F9 of harness-runtime-prototype): the harness candidate check (B124) uses the same result
 * check as `task check-result`, so its forbidden-path part sees both paths of a rename. Before B151 git's rename
 * detection collapsed a move into its new path: a candidate that moved the state file `openspec/executors.yaml`
 * to an unforbidden path passed the check and reached the validator. A candidate whose changed paths cannot be read
 * (`diff_unavailable`) never passes either.
 */

function project() {
  const root = tempDir('sdlc-harness-paths-');
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), '// original\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial']);
  const env = humanEnv(tempDir('sdlc-harness-home-'));
  const cli = (args: string[]) => {
    const result = runCli([...args, '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result;
  };
  cli(['init', '--tools', 'codex']);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const raw = parse(read(file));
  raw.enforcement.mode = 'block';
  raw.verify.commands = [{ name: 'candidate', run: 'node check.cjs', required: true }];
  write(file, stringify(raw));
  write(path.join(root, 'check.cjs'), [
    "const fs=require('fs');",
    "const text=fs.readFileSync('src/greet.js','utf8').replace(/\\r\\n/g,'\\n');",
    "if(text!=='// candidate\\n')process.exit(1);",
  ].join('\n'));
  cli(['new', 'add-farewell', '--risk', 'medium']);
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  write(change('intent.md'), FILES['intent.md']);
  cli(['approve', 'intent', '--change', 'add-farewell']);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  cli(['approve', 'spec', '--change', 'add-farewell']);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Implement farewell\n- [ ] 1.2 Another task\n');
  write(path.join(root, 'openspec/executors.yaml'), stringify({ executors: {
    hosted: { type: 'harness', max_risk: 'medium' },
  } }));
  cli(['approve', 'plan', '--change', 'add-farewell']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source']);
  const paths = projectPaths(root);
  const config = loadConfig(file);
  const ref = resolveChange(paths, 'add-farewell');
  const claim = claimTask(root, paths, config, { change: ref.id, task: '1.1', executor: 'hosted', agent: 'codex' });
  return { root, env, config, ref, claim };
}

function localRuntime(p: ReturnType<typeof project>, sandbox: string) {
  const mapPath = (value: string) => value.replace(/^\/workspace(?=\/|$)/, sandbox);
  return { exec: async (_session: string, argv: string[], stdin = '', workdir = '/workspace') => {
    if (argv[0] === 'sdlc') {
      const result = runCli(argv.slice(1), mapPath(workdir), p.env);
      return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    const result = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1).map(mapPath), {
      cwd: mapPath(workdir), env: p.env, input: stdin, encoding: 'utf8', timeout: 15000,
    });
    return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } };
}

/** Trusted fixture code only. This local test callback does not provide an OS security boundary. */
function fixtureValidator(p: ReturnType<typeof project>) {
  return vi.fn(async (request: HarnessValidationRequest) => {
    const directory = tempDir('sdlc-trusted-fixture-validator-');
    const bundle = path.join(directory, 'candidate.bundle');
    const checkout = path.join(directory, 'checkout');
    fs.writeFileSync(bundle, request.bundle);
    fs.mkdirSync(checkout);
    initGitRepo(checkout);
    git(checkout, ['fetch', '-q', bundle, `${request.ref}:refs/heads/candidate`]);
    git(checkout, ['switch', '--detach', request.commit]);
    const run = await verification.runVerification(checkout, { ...p.config, verify: request.verification });
    return { run, fingerprint: worktreeFingerprint(checkout, FINGERPRINT_EXCLUDES) };
  });
}

/** A host on a prepared local sandbox; `candidate` writes the candidate's one commit in the sandbox checkout. */
async function prepared(p: ReturnType<typeof project>, candidate: (checkout: string) => void) {
  const sandbox = tempDir('sdlc-harness-paths-sandbox-');
  const validateCandidate = fixtureValidator(p);
  const host = new HarnessBundleHost({ ...p, runtime: localRuntime(p, sandbox) as unknown as HarnessRuntime,
    tool: 'codex', validateCandidate });
  await host.prepare('local', p.claim.item);
  const checkout = path.join(sandbox, 'project');
  initGitRepo(checkout);
  candidate(checkout);
  git(checkout, ['commit', '-qm', [
    'candidate', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.1', 'SDLC-Agent: hosted/codex',
  ].join('\n')]);
  return { host, validateCandidate };
}

/** The passing edit: the candidate check accepts exactly this content of `src/greet.js`. */
function passingEdit(checkout: string): void {
  write(path.join(checkout, 'src/greet.js'), '// candidate\n');
  git(checkout, ['add', '--', 'src/greet.js']);
}

describe('B151: the harness candidate check sees renames and unreadable diffs', () => {
  it('refuses a candidate that renames a state file away and never calls the validator', async () => {
    const p = project();
    const { host, validateCandidate } = await prepared(p, (checkout) => {
      fs.mkdirSync(path.join(checkout, 'docs'), { recursive: true });
      git(checkout, ['mv', 'openspec/executors.yaml', 'docs/executors-copy.yaml']);
      // The edit the candidate check accepts, so the move is the only defect.
      passingEdit(checkout);
    });
    const resultSpy = vi.spyOn(taskResult, 'checkResultCore');
    try {
      const verdict = await host.verify('local', p.claim.item);
      const checked = resultSpy.mock.results.map((result) => result.value);
      expect(validateCandidate, JSON.stringify(checked)).not.toHaveBeenCalled();
      expect(verdict.passed).toBe(false);
      // Review round 1, F10: refused for the move, not for an unrelated reason.
      expect(checked.flatMap((result) => result.problems))
        .toContainEqual(expect.objectContaining({ code: 'forbidden_path', file: 'openspec/executors.yaml' }));
    } finally {
      vi.restoreAllMocks();
    }
  }, 120000);

  it('refuses a candidate when the result check reports diff_unavailable', async () => {
    // Guard, green before and after B151: the host already refuses any result that is not ok. A verified bundle
    // cannot carry a missing tree (`git bundle verify`), so the problem is injected through the real result.
    const p = project();
    const { host, validateCandidate } = await prepared(p, passingEdit);
    const real = taskResult.checkResultCore;
    const unavailable = { code: 'diff_unavailable' } as unknown as taskResult.ResultProblem;
    const resultSpy = vi.spyOn(taskResult, 'checkResultCore').mockImplementation((...args) => {
      const checked = real(...args);
      return { ...checked, ok: false, files: [], problems: [...checked.problems, unavailable] };
    });
    try {
      expect((await host.verify('local', p.claim.item)).passed).toBe(false);
      expect(resultSpy).toHaveBeenCalled();
      expect(validateCandidate).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  }, 120000);
});
