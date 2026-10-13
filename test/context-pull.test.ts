import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B101: context packs from the team knowledge server. Customer decision: packs are pulled into files, so they stay
 * in git and under review and `sdlc instructions` stays offline.
 * - sdlc.yaml `context.sources`: a list of `{ name, server, resource | tool (+ args), stages, owner, fresh_days? }`;
 *   `server` is a name in `mcp.servers`.
 * - `sdlc context pull [--name <name>] [--json]` reads each source (an MCP resource, or the text a tool answers) and
 *   writes `docs/context/<name>.md` with the usual header (owner, `source: mcp:<server> <resource or tool>`,
 *   updated: today, fresh_days, stages) and the text as the body. JSON: `{ pulled: [{ name, file }], failed: [] }`.
 * - A source that fails is reported in `failed` (exit code 1) and its existing file is left as it was.
 * - A name that is not a plain file name (`../x`, `a/b`) or a server that is not in `mcp.servers` is an invalid
 *   configuration; nothing is written outside docs/context/.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-knowledge.mjs').replace(/\\/g, '/');
const today = () => new Date().toISOString().slice(0, 10);

function project(sources: Record<string, unknown>[]) {
  const root = tempDir('sdlc-context-pull-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { kb: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.context = { sources };
  write(file, stringify(config));
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  const pack = (name: string) => path.join(root, 'docs/context', `${name}.md`);
  return { root, cli, pack };
}

const GLOSSARY = { name: 'glossary', server: 'kb', resource: 'kb://glossary', stages: ['design'], owner: 'docs-team',
  fresh_days: 30 };
const FAQ = { name: 'faq', server: 'kb', tool: 'search_docs', args: { query: 'claims' }, stages: ['build'],
  owner: 'support' };

describe('B101: sdlc context pull', () => {
  it('writes one pack per source with the header; instructions then deliver it for its stage', () => {
    const p = project([GLOSSARY, FAQ]);
    const r = p.cli(['context', 'pull', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().pulled.map((item: { name: string }) => item.name).sort()).toEqual(['faq', 'glossary']);
    expect(r.json().failed).toEqual([]);
    const glossary = read(p.pack('glossary'));
    expect(glossary).toMatch(/^---\n/);
    expect(glossary).toContain('owner: docs-team');
    expect(glossary).toContain('source: mcp:kb kb://glossary');
    expect(glossary).toContain(`updated: ${today()}`);
    expect(glossary).toContain('Claim: a request for payment under a policy.');
    expect(read(p.pack('faq'))).toContain('Answer for: claims');
    const out = p.cli(['instructions', 'proposal', '--change', 'add-export', '--json']).json();
    const paths = out.contextSources.map((source: { path: string }) => source.path);
    expect(paths).toEqual(['docs/context/glossary.md']);
    expect(out.contextSkipped ?? []).toEqual([]);
  }, 240000);

  it('--name pulls one source only', () => {
    const p = project([GLOSSARY, FAQ]);
    expect(p.cli(['context', 'pull', '--name', 'faq', '--json']).code).toBe(0);
    expect(fs.existsSync(p.pack('faq'))).toBe(true);
    expect(fs.existsSync(p.pack('glossary'))).toBe(false);
  }, 240000);

  it('negative: a failing source is reported and its existing file stays as it was', () => {
    const p = project([GLOSSARY]);
    const old = ['---', 'owner: docs-team', 'source: old', 'updated: 2026-01-01', 'stages: [design]', '---', '', 'Old.'];
    write(p.pack('glossary'), `${old.join('\n')}\n`);
    const r = p.cli(['context', 'pull', '--json'], { FAKE_KB_FAIL: '1' });
    expect(r.code).toBe(1);
    expect(r.json().failed.map((item: { name: string }) => item.name)).toEqual(['glossary']);
    expect(read(p.pack('glossary'))).toContain('Old.');
  }, 240000);

  it('negative: a name that is not a plain file name, or an unknown server, is refused and writes nothing', () => {
    const bads = [{ ...GLOSSARY, name: '../escape' }, { ...GLOSSARY, name: 'a/b' }, { ...GLOSSARY, server: 'x' }];
    for (const bad of bads) {
      const p = project([bad]);
      const r = p.cli(['context', 'pull', '--json']);
      expect(r.code, JSON.stringify(bad)).not.toBe(0);
      expect(fs.existsSync(path.join(p.root, 'docs/escape.md'))).toBe(false);
      expect(fs.existsSync(path.join(p.root, 'docs/context'))).toBe(false);
    }
  }, 300000);
});
