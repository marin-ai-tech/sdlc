import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDeltaTargets, findOverlaps, parseDeltaFile } from '../src/core/deltas.js';
import { defaultConfig, parseConfig, serializeConfig } from '../src/core/config.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

const delta = `# Delta
## ADDED Requirements
### Requirement: New thing
text
#### Scenario: works
- **WHEN** x
- **THEN** y
## MODIFIED Requirements
### Requirement: Session expiry
text
#### Scenario: idle
## REMOVED Requirements
### Requirement: Remember me
## RENAMED Requirements
- FROM: \`### Requirement: Old name\`
- TO: \`### Requirement: New name\`
`;

describe('delta parsing and checks', () => {
  it('parses operations, renames and scenarios', () => {
    const d = parseDeltaFile(delta, 'auth', 'specs/auth/spec.md');
    expect(d.entries.map((e) => [e.op, e.requirement, e.to])).toEqual([
      ['added', 'New thing', undefined],
      ['modified', 'Session expiry', undefined],
      ['removed', 'Remember me', undefined],
      ['renamed', 'Old name', 'New name'],
    ]);
    expect(d.scenarios).toEqual(['works', 'idle']);
  });

  it('flags MODIFIED/RENAMED targets missing from the living spec and ADDED collisions', () => {
    const root = tempDir();
    write(path.join(root, 'openspec/specs/auth/spec.md'), '# auth\n## Purpose\nx\n## Requirements\n### Requirement: New thing\n### Requirement: Old name\n');
    const issues = checkDeltaTargets(projectPaths(root), [parseDeltaFile(delta, 'auth', 'specs/auth/spec.md')]);
    const byLevel = (level: string) => issues.filter((i) => i.level === level).map((i) => i.message.split(' ')[0] + ' ' + i.message.split('"')[1]);
    expect(byLevel('error')).toEqual(['ADDED New thing', 'MODIFIED Session expiry']);
    expect(byLevel('warning')).toEqual(['REMOVED Remember me']);
  });

  it('rejects MODIFIED against a capability with no main spec', () => {
    const root = tempDir();
    const issues = checkDeltaTargets(projectPaths(root), [parseDeltaFile('## MODIFIED Requirements\n### Requirement: X\n', 'billing', 'specs/billing/spec.md')]);
    expect(issues[0].message).toMatch(/has no main spec yet/);
  });

  it('finds requirements changed by more than one open change', () => {
    const a = parseDeltaFile('## MODIFIED Requirements\n### Requirement: Login\n', 'auth', 'f');
    const b = parseDeltaFile('## REMOVED Requirements\n### Requirement: login\n', 'auth', 'f');
    const c = parseDeltaFile('## ADDED Requirements\n### Requirement: Other\n', 'auth', 'f');
    const overlaps = findOverlaps([{ id: 'a', deltas: [a] }, { id: 'b', deltas: [b] }, { id: 'c', deltas: [c] }]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].changes.map((x) => x.change)).toEqual(['a', 'b']);
  });
});

describe('sdlc.yaml config', () => {
  it('defaults every field from an empty file', () => {
    const c = parseConfig({});
    expect(c.schema).toBe('sdlc');
    expect(c.enforcement.mode).toBe('warn');
    expect(c.gates.release.required).toBe(false);
  });
  it('round-trips through serialize/parse', () => {
    const c = defaultConfig();
    c.cli = 'npx sdlc';
    c.verify.commands = [{ name: 'test', run: 'npm test', required: true }, { name: 'e2e', run: 'npm run e2e', required: false, timeoutSeconds: 60 }];
    c.gates.plan.artifacts = ['plan', 'tasks'];
    c.roles = { 'code-owner': ['pat@example.com'] };
    expect(parseConfig(serializeConfig(c))).toEqual(c);
  });
  it('rejects invalid values with a clear message', () => {
    expect(() => parseConfig({ enforcement: { mode: 'strict' } })).toThrow(/off, warn, or block/);
    expect(() => parseConfig({ gates: { deploy: { required: true } } })).toThrow(/not a known gate/);
    expect(() => parseConfig({ release: { commands: ['(' ] } })).toThrow(/invalid regular expression/);
    expect(() => parseConfig({ cli: 'sdlc; rm -rf /' })).toThrow(/may only contain/);
  });
  it('accepts verify commands written as plain strings', () => {
    expect(parseConfig({ verify: { commands: ['make test'] } }).verify.commands).toEqual([{ name: 'make', run: 'make test', required: true }]);
  });
});
