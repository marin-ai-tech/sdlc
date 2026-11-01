import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { forbiddenPaths } from '../src/core/task-contract.js';
import { BIN, humanEnv, read, tempDir, write } from './helpers.js';

const LOCKS = ['log', 'board'] as const;
const DENIED = { decision: 'deny', rule: 'state-integrity' };

function fixture(lock: string) {
  const root = tempDir('sdlc-writer-coordination-guard-');
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  config.enforcement.requireApprovedPlan = false;
  config.log = { enabled: false, hookDecisions: false };
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(config)));
  const dir = `openspec/.sdlc/${lock}.lock.writers`;
  const digest = createHash('sha256').update('guard-fixture').digest('hex');
  const name = () => `${process.pid}-u-${digest}-${randomUUID()}`;
  const current = `${dir}/${name()}.json`;
  const fresh = `${dir}/${name()}.json`;
  const partial = `${dir}/${name()}.next`;
  write(path.join(root, current), JSON.stringify({ pid: process.pid, ticket: 1 }));
  const ctx = { paths: projectPaths(root), config };
  const evaluate = (tool: string, input: Record<string, unknown>) =>
    evaluateToolCall(normalizeToolCall(tool, input, root), ctx);
  const edit = (file: string) => evaluate('Edit', { file_path: path.join(root, file) });
  const shell = (command: string) => evaluate('Bash', { command });
  return { root, config, dir, current, fresh, partial, evaluate, edit, shell };
}

type Fixture = ReturnType<typeof fixture>;

function preTool(p: Fixture, tool: string, input: Record<string, unknown>) {
  const env = humanEnv(tempDir('sdlc-writer-coordination-hook-'), { SDLC_AGENT: 'guard-proof' });
  const result = spawnSync(process.execPath, [BIN, 'hook', 'pre-tool', '--agent', 'codex'], {
    cwd: p.root, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
    input: JSON.stringify({ cwd: p.root, tool_name: tool, tool_input: input, skip_log: true }),
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim() || '{}').hookSpecificOutput;
}

function shellCases(p: Fixture) {
  return [
    ['literal overwrite', `echo forged > ${p.current}`],
    ['new ticket', `tee ${p.fresh}`],
    ['partial publication', `Set-Content -LiteralPath '${p.partial}' -Value forged`],
    ['bare ticket after cd', `cd ${p.dir} && echo forged > ${path.basename(p.current)}`],
    ['ticket glob', `rm ${p.dir}/*.json`],
    ['directory glob', `rm -rf openspec/.sdlc/${path.basename(p.dir).replace('.writers', '.writer?')}`],
    ['folder removal', `rm -rf ${p.dir}`],
    ['PowerShell folder removal', `Remove-Item -LiteralPath '${p.dir}' -Recurse -Force`],
    ['cmd folder removal', `rmdir /s /q ${p.dir}`],
  ];
}

describe.each(LOCKS)('%s writer coordination is protected harness state', lock => {
  it.each(['current', 'fresh', 'partial'] as const)('denies direct edits of %s tickets in warn mode', kind => {
    const p = fixture(lock);
    expect(p.edit(p[kind])).toMatchObject(DENIED);
  });

  it.each(['current', 'fresh', 'partial'] as const)('task contract forbids %s tickets', kind => {
    const p = fixture(lock);
    const matches = picomatch(forbiddenPaths(p.root, p.config, false), { dot: true, nocase: true });
    expect(matches(p[kind]), p[kind]).toBe(true);
  });

  for (let index = 0; index < 9; index++) {
    it(`denies shell mutation spelling ${index + 1}`, () => {
      const p = fixture(lock);
      const [label, command] = shellCases(p)[index];
      expect(p.shell(command), `${label}: ${command}`).toMatchObject(DENIED);
    });
  }

  it.each(['Edit', 'Write', 'apply_patch'])('real Codex pre-tool hook denies %s ticket mutations', tool => {
    const p = fixture(lock);
    const input = tool === 'apply_patch'
      ? { command: `*** Begin Patch\n*** Add File: ${p.fresh}\n+forged\n*** End Patch` }
      : { file_path: path.join(p.root, tool === 'Edit' ? p.current : p.fresh), content: 'forged' };
    const before = read(path.join(p.root, p.current));
    const answer = preTool(p, tool, input);
    expect(answer).toMatchObject({ permissionDecision: 'deny' });
    expect(answer.permissionDecisionReason).toContain('[sdlc:state-integrity]');
    expect(read(path.join(p.root, p.current))).toBe(before);
    expect(fs.existsSync(path.join(p.root, p.fresh))).toBe(false);
  });

  it.each([0, 1, 4, 6])('real Codex hook denies shell mutation spelling %s', index => {
    const p = fixture(lock);
    const [label, command] = shellCases(p)[index];
    const answer = preTool(p, 'Bash', { command });
    expect(answer, label).toMatchObject({ permissionDecision: 'deny' });
    expect(answer.permissionDecisionReason).toContain('[sdlc:state-integrity]');
    expect(fs.existsSync(path.join(p.root, p.current))).toBe(true);
  });

  it.each(['edit', 'shell', 'hook'])('denies a hardlink alias through %s', surface => {
    const p = fixture(lock);
    const alias = 'ticket-alias.txt';
    fs.linkSync(path.join(p.root, p.current), path.join(p.root, alias));
    if (surface === 'edit') expect(p.edit(alias)).toMatchObject(DENIED);
    if (surface === 'shell') expect(p.shell(`echo forged > ${alias}`)).toMatchObject(DENIED);
    if (surface === 'hook') {
      expect(preTool(p, 'Edit', { file_path: path.join(p.root, alias) }))
        .toMatchObject({ permissionDecision: 'deny' });
    }
  });

  it('permits reads of coordination tickets and unrelated similarly named directories', () => {
    const p = fixture(lock);
    for (const command of [`cat ${p.current}`, `Get-Content '${p.current}'`, `ls ${p.dir}`]) {
      expect(p.shell(command), command).toMatchObject({ decision: 'allow' });
    }
    expect(p.evaluate('Read', { file_path: path.join(p.root, p.current) }).decision).toBe('allow');
    expect(preTool(p, 'Read', { file_path: path.join(p.root, p.current) })?.permissionDecision).not.toBe('deny');
    const ordinary = 'openspec/.sdlc/foo.lock.writers';
    const elsewhere = `docs/${lock}.lock.writers`;
    for (const dir of [ordinary, elsewhere]) {
      write(path.join(p.root, dir, 'a.json'), '{}\n');
      fs.linkSync(path.join(p.root, dir, 'a.json'), path.join(p.root, `${path.basename(dir)}-alias.txt`));
      expect(p.edit(`${dir}/a.json`).decision).toBe('allow');
      expect(p.edit(`${path.basename(dir)}-alias.txt`).decision).toBe('allow');
      expect(p.shell(`echo ordinary > ${dir}/new.json`).decision).toBe('allow');
      expect(p.shell(`rm -rf ${dir}`).decision).toBe('allow');
    }
  });
});
