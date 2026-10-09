import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

function context() {
  const root = tempDir('sdlc-hardening-');
  return { root, ctx: { paths: projectPaths(root), config: defaultConfig() } };
}

const bash = (root: string, command: string) => normalizeToolCall('Bash', { command }, root);

describe('agents cannot pass for a person by clearing the agent markers', () => {
  it('unsetting or blanking CLAUDECODE, OPENCODE, AGENT or SDLC_AGENT is denied, in sh and PowerShell', () => {
    const { root, ctx } = context();
    const commands = [
      'env -u CLAUDECODE sdlc status',
      'env -u SDLC_AGENT -u OPENCODE node bin/sdlc.js approve plan --change x',
      'CLAUDECODE= sdlc approvals',
      'unset AGENT; sdlc status',
      'export OPENCODE=',
      'env -i PATH="$PATH" sdlc status',
      'Remove-Item Env:CLAUDECODE; sdlc status',
      '$env:SDLC_AGENT = ""; sdlc status',
      '[Environment]::SetEnvironmentVariable("AGENT", $null)',
      'declare +x OPENCODE; sdlc status',
      'typeset +x CLAUDECODE',
    ];
    for (const command of commands) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'agent-marker' });
    }
  });

  it('negative: reading the markers or setting other variables stays allowed', () => {
    const { root, ctx } = context();
    for (const command of ['echo $CLAUDECODE', 'env | grep AGENT', 'export AGENT_NAME=docs', 'FOO= make test',
      'printenv OPENCODE', 'SDLC_LOCALE=ru sdlc status']) {
      expect(evaluateToolCall(bash(root, command), ctx).decision, command).toBe('allow');
    }
  });
});

describe('state-file writes are caught however the path is spelled', () => {
  it('a write after cd, by bare file name, is denied', () => {
    const { root, ctx } = context();
    for (const command of ['cd openspec && echo x >> backlog.md', 'cd openspec; sed -i s/B2/B1/ roles.yaml',
      'pushd openspec/changes/x && echo y > .sdlc.yaml']) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('a write through a glob that can match a state file is denied', () => {
    const { root, ctx } = context();
    for (const command of ['echo x >> openspec/backlog.m?', 'cp new.md openspec/backl*', 'tee openspec/roles.y[a]ml']) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('an edit of a link that resolves to a state file is denied', (context_) => {
    const { root, ctx } = context();
    write(path.join(root, 'openspec/backlog.md'), '# Backlog\n');
    try {
      fs.symlinkSync(path.join(root, 'openspec/backlog.md'), path.join(root, 'notes.md'));
    } catch {
      context_.skip();
    }
    const decision = evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, 'notes.md') }, root), ctx);
    expect(decision).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('negative: other files with the same names elsewhere stay writable', () => {
    const { root, ctx } = context();
    for (const command of ['echo x >> docs/backlog.md', 'cp a.yaml config/roles.yaml', 'cat openspec/backlog.md',
      'grep -n B1 backlog.md']) {
      // 0.14.0: shell writes count for the plan gate, so a write to code before the plan may be warned about; what this
      // case checks is that the state-file rule leaves files of the same name elsewhere alone.
      const decision = evaluateToolCall(bash(root, command), ctx);
      expect(decision.decision, command).not.toBe('deny');
      expect(decision.rule, command).not.toBe('state-integrity');
    }
    write(path.join(root, 'docs/notes.md'), 'x\n');
    const edit = normalizeToolCall('Edit', { file_path: path.join(root, 'docs/notes.md') }, root);
    expect(evaluateToolCall(edit, ctx).decision).toBe('allow');
  });
});
