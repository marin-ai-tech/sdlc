import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig, parseConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change registry-and-event-servers-stay-with-the-cli (E2E OpenCode 2026-11-14: P4).
// The team registry and the receivers of sdlc's events serve the CLI. An agent that could call them could forge the
// registry's usage records; so they stay out of the agents' MCP configs unless a person says otherwise, and an
// agent's call to an events tool is refused.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const stdio = (extra: Record<string, unknown> = {}) => ({ type: 'stdio', command: ['node', FAKE], ...extra });

function raw(servers: Record<string, Record<string, unknown>>) {
  return {
    version: 1,
    mcp: { servers },
    events: [{ server: 'notify', tool: 'report_outcome', on: ['gate.*'] }],
    team: { mode: 'team', registry: 'registry' },
  };
}

const flag = (config: ReturnType<typeof parseConfig>, name: string) =>
  config.mcp?.servers.find((server) => server.name === name)?.agents;

describe('P4.C1 the registry and events servers default to the CLI only', () => {
  it('a server named by events or team.registry has agents false when the key is absent', () => {
    const config = parseConfig(raw({ notify: stdio(), registry: stdio(), build: stdio() }));
    expect(flag(config, 'notify')).toBe(false);
    expect(flag(config, 'registry')).toBe(false);
  });

  it('negative: a server neither of them names keeps agents true', () => {
    const config = parseConfig(raw({ notify: stdio(), registry: stdio(), build: stdio() }));
    expect(flag(config, 'build')).toBe(true);
  });

  it("a person's explicit agents: true is kept", () => {
    const config = parseConfig(raw({ notify: stdio({ agents: true }), registry: stdio(), build: stdio() }));
    expect(flag(config, 'notify')).toBe(true);
  });
});

describe('P4.C2 sdlc update leaves them out of the agents configuration', () => {
  it('the .mcp.json sdlc writes has the other server only', () => {
    const root = tempDir('sdlc-p4-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    Object.assign(config, raw({ notify: stdio(), registry: stdio(), build: stdio() }));
    write(file, stringify(config));
    const update = runCli(['update', '--json'], root, env);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    const names = Object.keys(JSON.parse(read(path.join(root, '.mcp.json'))).mcpServers ?? {});
    expect(names).toContain('build');
    expect(names).not.toContain('notify');
    expect(names).not.toContain('registry');
  }, 180000);
});

describe("P4.C3 an agent's call to an events tool is refused", () => {
  function decide(tool: string, mode: 'block' | 'warn' | 'off', agents = true) {
    const root = tempDir('sdlc-p4-hook-');
    const config = defaultConfig();
    const parsed = parseConfig(raw({ notify: stdio({ agents }), registry: stdio(), build: stdio() }));
    config.mcp = parsed.mcp;
    config.events = parsed.events;
    config.team = parsed.team;
    config.enforcement.mode = mode;
    return evaluateToolCall(normalizeToolCall(tool, {}, root), { paths: projectPaths(root), config });
  }

  it.each(['mcp__notify__report_outcome', 'notify_report_outcome'])('%s is denied in block and in warn', (tool) => {
    expect(decide(tool, 'block')).toMatchObject({ decision: 'deny', rule: 'mcp-events' });
    expect(decide(tool, 'warn')).toMatchObject({ decision: 'deny', rule: 'mcp-events' });
  });

  it('negative: another tool of the same server is not refused by this rule', () => {
    expect(decide('mcp__notify__ping', 'block').rule).not.toBe('mcp-events');
  });

  it('negative: with enforcement off nothing is refused', () => {
    expect(decide('mcp__notify__report_outcome', 'off').decision).toBe('allow');
  });
});

describe('P4.C4 doctor names an events or registry server laid out for agents', () => {
  it('explicit agents: true on the events server is a warning that names it', () => {
    const root = tempDir('sdlc-p4-doctor-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    Object.assign(config, raw({ notify: stdio({ agents: true }), registry: stdio(), build: stdio() }));
    write(file, stringify(config));
    const doctor = runCli(['doctor'], root, env);
    expect(doctor.stdout + doctor.stderr).toMatch(/notify[^\n]*agents|agents[^\n]*notify/);
  }, 180000);
});
