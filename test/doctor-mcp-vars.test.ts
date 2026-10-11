import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.1: `sdlc doctor` checks that the `${VAR}` references of the MCP registry (in `env` and `headers` of
 * `mcp.servers`) are set in the environment. A missing one is a warning that names the server and the variable —
 * never a value. All set: the check is ok.
 */

function project(extra: NodeJS.ProcessEnv) {
  const root = tempDir('sdlc-doctor-vars-');
  // The machine's own JIRA_TOKEN must not leak into the test; the case's variables come after.
  const env = humanEnv(tempDir('sdlc-home-'));
  delete env.JIRA_TOKEN;
  Object.assign(env, extra);
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: {
    build: { type: 'stdio', command: ['node', 'build.js'], env: { CI_TOKEN: '${CI_TOKEN}' }, stages: ['test'] },
    jira: { type: 'http', url: 'https://mcp.corp.example/jira', headers: { Authorization: 'Bearer ${JIRA_TOKEN}' },
      stages: ['plan'] },
  } };
  write(file, stringify(config));
  return () => cli(['doctor', '--json']).json();
}

const varsCheck = (doctor: { checks: Array<{ check: string; status: string; message: string }> }) =>
  doctor.checks.find((c) => /mcp/i.test(c.check) && /var|secret|env/i.test(`${c.check} ${c.message}`));

describe('sdlc doctor and the variables of the MCP registry', () => {
  it('warns about a missing variable, naming the server and the variable, never a value', () => {
    const doctor = project({ CI_TOKEN: 'ci-secret-123' })();
    const check = varsCheck(doctor);
    expect(check, JSON.stringify(doctor.checks.map((c: { check: string }) => c.check))).toBeDefined();
    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('JIRA_TOKEN');
    expect(check?.message).toContain('jira');
    expect(check?.message).not.toContain('CI_TOKEN');
    expect(JSON.stringify(doctor)).not.toContain('ci-secret-123');
  }, 120000);

  it('negative: every variable set: the check is ok', () => {
    const doctor = project({ CI_TOKEN: 'a', JIRA_TOKEN: 'b' })();
    expect(varsCheck(doctor)?.status ?? 'ok').toBe('ok');
  }, 120000);
});
