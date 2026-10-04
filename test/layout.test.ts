import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultConfig, parseConfig, serializeConfig } from '../src/core/config.js';
import {
  adaptLayout,
  detectLayout,
  LAYOUT_ROLES,
  renderLayoutTemplate,
  scaffoldLayout,
  type LayoutRoleId,
  type TemplateContext,
} from '../src/core/layout.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const role = (report: ReturnType<typeof detectLayout>, id: LayoutRoleId) => report.roles.find((r) => r.role === id)!;
const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  const paths = Object.fromEntries(LAYOUT_ROLES.map((r) => [r.id, r.path])) as Record<LayoutRoleId, string>;
  return { projectName: 'demo', paths, verifyCommands: [{ name: 'test', run: 'npm test' }], cli: 'sdlc', ...overrides };
}

describe('layout role table', () => {
  it('has one role per id with a canonical path, a template and a purpose', () => {
    const ids = LAYOUT_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of LAYOUT_ROLES) {
      expect(r.path, r.id).not.toMatch(/\\/);
      expect(r.kind === 'dir' ? r.path.endsWith('/') : !r.path.endsWith('/'), r.id).toBe(true);
      expect(r.purpose.length, r.id).toBeGreaterThan(10);
    }
  });
});

describe('detectLayout', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('sdlc-layout-');
  });

  it('an empty project has every role missing and is not ready', () => {
    const report = detectLayout(root);
    expect(report.roles.map((r) => r.role)).toEqual(LAYOUT_ROLES.map((r) => r.id));
    expect(report.roles.every((r) => r.status === 'missing' && r.path === undefined)).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.score).toBe(0);
    expect(report.missingRequired.sort()).toEqual(LAYOUT_ROLES.filter((r) => r.required).map((r) => r.id).sort());
  });

  it('finds canonical files, aliases (case-insensitive) and directories', () => {
    write(path.join(root, 'AGENTS.md'), '# Agents\n');
    write(path.join(root, 'Architecture.md'), '# Arch\n');
    write(path.join(root, 'docs/adr/0001-x.md'), '# ADR\n');
    const report = detectLayout(root);
    expect(role(report, 'agents-guide')).toMatchObject({ status: 'canonical', path: 'AGENTS.md' });
    expect(role(report, 'architecture')).toMatchObject({ status: 'alias', path: 'Architecture.md' });
    expect(role(report, 'decisions')).toMatchObject({ status: 'alias', path: 'docs/adr/' });
    expect(report.score).toBe(Math.round((3 / LAYOUT_ROLES.length) * 100));
  });

  it('prefers the canonical path and lists every existing candidate', () => {
    write(path.join(root, 'docs/architecture.md'), '# canonical\n');
    write(path.join(root, 'ARCHITECTURE.md'), '# alias\n');
    const r = role(detectLayout(root), 'architecture');
    expect(r).toMatchObject({ status: 'canonical', path: 'docs/architecture.md' });
    expect(r.candidates).toEqual(['docs/architecture.md', 'ARCHITECTURE.md']);
  });

  it('honours the layout mapping, and reports a mapping to nothing as missing with a warning', () => {
    write(path.join(root, 'handbook/design.md'), '# Design\n');
    const report = detectLayout(root, { architecture: 'handbook/design.md', glossary: 'handbook/words.md' });
    expect(role(report, 'architecture')).toMatchObject({ status: 'mapped', path: 'handbook/design.md' });
    expect(role(report, 'glossary').status).toBe('missing');
    expect(report.warnings.join('\n')).toMatch(/handbook\/words\.md/);
  });

  it('negative: files with a matching name elsewhere, or of the wrong kind, are not candidates', () => {
    write(path.join(root, 'src/architecture.md'), '# not a project doc\n');
    write(path.join(root, 'packages/a/AGENTS.md'), '# nested\n');
    write(path.join(root, 'docs/decisions'), 'a file, not a folder\n');
    const report = detectLayout(root);
    expect(role(report, 'architecture').status).toBe('missing');
    expect(role(report, 'agents-guide').status).toBe('missing');
    expect(role(report, 'decisions').status).toBe('missing');
  });

  it('is ready once every required role is present', () => {
    for (const r of LAYOUT_ROLES.filter((x) => x.required)) write(path.join(root, r.path), '# x\n');
    const report = detectLayout(root);
    expect(report.ready).toBe(true);
    expect(report.missingRequired).toEqual([]);
  });
});

describe('renderLayoutTemplate', () => {
  it('fills project name, cli, verify commands and role paths relative to the written file', () => {
    const text = '# {{project.name}}\nRun `{{cli}} status`.\n{{verify.commands}}\n[arch]({{path:architecture}}) [adr]({{path:decisions}})\n';
    const atRoot = renderLayoutTemplate(text, 'AGENTS.md', ctx());
    expect(atRoot).toContain('# demo');
    expect(atRoot).toContain('Run `sdlc status`.');
    expect(atRoot).toMatch(/^- .*npm test/m);
    expect(atRoot).toContain('[arch](docs/architecture.md)');
    expect(atRoot).toContain('[adr](docs/decisions/)');
    const inDocs = renderLayoutTemplate('[agents]({{path:agents-guide}}) [arch]({{path:architecture}})', 'docs/runbook.md', ctx());
    expect(inDocs).toBe('[agents](../AGENTS.md) [arch](architecture.md)');
  });

  it('uses mapped paths', () => {
    const c = ctx();
    c.paths.architecture = 'ARCHITECTURE.md';
    expect(renderLayoutTemplate('[a]({{path:architecture}})', 'AGENTS.md', c)).toBe('[a](ARCHITECTURE.md)');
  });

  it('says how to configure checks when there are none', () => {
    const out = renderLayoutTemplate('{{verify.commands}}', 'AGENTS.md', ctx({ verifyCommands: [] }));
    expect(out).toMatch(/sdlc\.yaml/);
  });

  it('negative: an unknown token is an error, not a hole in the output', () => {
    expect(() => renderLayoutTemplate('{{nope}}', 'AGENTS.md', ctx())).toThrow(/nope/);
    expect(() => renderLayoutTemplate('{{path:nope}}', 'AGENTS.md', ctx())).toThrow(/nope/);
  });
});

describe('scaffoldLayout', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('sdlc-scaffold-');
  });

  it('creates every missing role from its template, with no unrendered tokens', () => {
    const result = scaffoldLayout(root, defaultConfig());
    for (const r of LAYOUT_ROLES) {
      const file = r.kind === 'dir' ? `${r.path}${path.posix.basename(r.template)}` : r.path;
      expect(exists(root, file), file).toBe(true);
      expect(read(path.join(root, file)), file).not.toMatch(/\{\{/);
    }
    expect(result.kept).toEqual([]);
    expect(read(path.join(root, 'CLAUDE.md'))).toMatch(/^@AGENTS\.md$/m);
    const agents = read(path.join(root, 'AGENTS.md'));
    for (const r of LAYOUT_ROLES.filter((x) => x.id !== 'agents-guide')) expect(agents, r.id).toContain(`](${r.path})`);
  });

  it('negative: never overwrites an existing file, and a second run creates nothing', () => {
    write(path.join(root, 'README.md'), '# Mine\n');
    const first = scaffoldLayout(root, defaultConfig());
    expect(first.kept).toContain('README.md');
    expect(first.created).not.toContain('README.md');
    expect(read(path.join(root, 'README.md'))).toBe('# Mine\n');
    const second = scaffoldLayout(root, defaultConfig());
    expect(second.created).toEqual([]);
  });

  it('dry run reports what it would create and writes nothing', () => {
    const result = scaffoldLayout(root, defaultConfig(), { dryRun: true });
    expect(result.created).toContain('AGENTS.md');
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('adaptLayout', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('sdlc-adapt-');
    write(path.join(root, 'README.md'), '# Legacy\n');
    write(path.join(root, 'ARCHITECTURE.md'), '# Arch\n');
    write(path.join(root, 'CONTRIBUTING.md'), '# How we work\n');
    write(path.join(root, 'docs/adr/0001-use-postgres.md'), '# ADR 1\n');
  });

  it('maps roles found at aliases, creates only missing roles, and links AGENTS.md to the real files', () => {
    const config = defaultConfig();
    const result = adaptLayout(root, config);
    expect(result.mapping).toEqual({ architecture: 'ARCHITECTURE.md', conventions: 'CONTRIBUTING.md', decisions: 'docs/adr/' });
    expect(config.layout).toEqual(result.mapping);
    expect(result.created).toEqual(expect.arrayContaining(['AGENTS.md', 'docs/runbook.md', 'docs/glossary.md']));
    const agents = read(path.join(root, 'AGENTS.md'));
    expect(agents).toContain('](ARCHITECTURE.md)');
    expect(agents).toContain('](CONTRIBUTING.md)');
    expect(agents).toContain('](docs/adr/)');
  });

  it('negative: moves nothing and does not create canonical copies of mapped roles', () => {
    adaptLayout(root, defaultConfig());
    expect(read(path.join(root, 'ARCHITECTURE.md'))).toBe('# Arch\n');
    expect(read(path.join(root, 'README.md'))).toBe('# Legacy\n');
    expect(exists(root, 'docs/architecture.md')).toBe(false);
    expect(exists(root, 'docs/conventions.md')).toBe(false);
    expect(exists(root, 'docs/decisions')).toBe(false);
  });
});

describe('layout in openspec/sdlc.yaml', () => {
  it('round-trips and defaults to empty', () => {
    expect(defaultConfig().layout).toEqual({});
    const config = parseConfig({ version: 1, layout: { architecture: 'ARCHITECTURE.md', decisions: 'docs/adr/' } });
    expect(config.layout).toEqual({ architecture: 'ARCHITECTURE.md', decisions: 'docs/adr/' });
    expect(parseConfig(serializeConfig(config)).layout).toEqual(config.layout);
    expect(serializeConfig(defaultConfig())).not.toHaveProperty('layout');
  });

  it('negative: rejects unknown roles and paths outside the project', () => {
    expect(() => parseConfig({ version: 1, layout: { blueprint: 'x.md' } })).toThrow(/blueprint/);
    expect(() => parseConfig({ version: 1, layout: { architecture: '../outside.md' } })).toThrow(/architecture/);
    expect(() => parseConfig({ version: 1, layout: { architecture: '/etc/passwd' } })).toThrow(/architecture/);
    expect(() => parseConfig({ version: 1, layout: { architecture: 'C:\\x.md' } })).toThrow(/architecture/);
  });
});

describe('sdlc layout (CLI)', () => {
  it('check, adapt and scaffold on an initialized project, logged', () => {
    const root = tempDir('sdlc-layout-cli-');
    const env = humanEnv(tempDir('sdlc-home-'));
    const cli = (args: string[]) => runCli(args, root, env);
    initGitRepo(root);
    write(path.join(root, 'ARCHITECTURE.md'), '# Arch\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);

    const check = cli(['layout', 'check', '--json']);
    expect(check.code, check.stderr).toBe(0);
    const report = check.json();
    expect(report.ready).toBe(false);
    expect(report.roles.find((r: { role: string }) => r.role === 'architecture')).toMatchObject({ status: 'alias', path: 'ARCHITECTURE.md' });
    expect(report.harness).toMatchObject({ tool: 'sdlc' });

    const adapt = cli(['layout', 'adapt', '--json']);
    expect(adapt.code, adapt.stderr).toBe(0);
    expect(adapt.json().mapping).toEqual({ architecture: 'ARCHITECTURE.md' });
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).layout).toEqual({ architecture: 'ARCHITECTURE.md' });

    const after = cli(['layout', 'check', '--json']).json();
    expect(after.ready).toBe(true);
    expect(after.roles.find((r: { role: string }) => r.role === 'architecture').status).toBe('mapped');

    const scaffold = cli(['layout', 'scaffold', '--json']).json();
    expect(scaffold.created).not.toContain('docs/architecture.md');

    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(expect.arrayContaining(['layout.adapted', 'layout.scaffolded']));
  });

  it('refuses outside an initialized project', () => {
    const root = tempDir('sdlc-layout-noinit-');
    const r = runCli(['layout', 'check', '--json'], root, humanEnv(tempDir('sdlc-home-')));
    expect(r.code).toBe(1);
  });
});
