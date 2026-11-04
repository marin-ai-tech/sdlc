import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B245: a refusal because one part of a command cannot be resolved statically names that part (E2E run of 2026-11-02,
 * findings S22 and S25). The commands are the ones the agents ran. Decisions stay; only the wording changes.
 */

function project() {
  const root = tempDir('sdlc-unresolved-');
  write(path.join(root, 'openspec/changes/demo/.sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'openspec/changes/demo/verification.md'), 'x\n');
  for (const file of ['index.html', 'style.css', 'calc.js']) write(path.join(root, file), 'x\n');
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config };
  return { root, decide: (command: string, tool = 'Bash') =>
    evaluateToolCall(normalizeToolCall(tool, { command }, root), ctx) };
}

describe('B245.C1: a copy of literal files to a variable destination', () => {
  it.each([
    ['cp index.html style.css calc.js "$T"/', '$T'],
    ['T=$(mktemp -d)/kids && mkdir -p "$T" && cp index.html style.css "$T"/ && ls "$T"', '$T'],
    ['cp index.html $DEST', '$DEST'],
  ])('%s is refused and names the destination', (command, part) => {
    const result = project().decide(command);
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain(part);
    expect(result.reason).toMatch(/destination/i);
    expect(result.reason).not.toMatch(/copy source/i);
  });

  it('a variable source is named as the source', () => {
    const result = project().decide('cp "$SRC" out.txt');
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain('$SRC');
    expect(result.reason).toMatch(/source/i);
  });
});

describe('B245.C2: an inline script whose string could match a state file', () => {
  // Reduced from the verify agent's check of the calculator: the multiplication sign in its table of cases.
  it.each([
    [`node -e 'const op="*";console.log(op)'`, '*'],
    [`node -e 'const cases=[["10*10",[1,0,"*",1,0,"="]]];console.log(cases)'`, '*'],
    [`node -e 'require("fs").writeFileSync("*","x")'`, '*'],
  ])('%s is refused and names the string, not the state files', (command, part) => {
    const result = project().decide(command);
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain(`"${part}"`);
    expect(result.reason).not.toContain('log.jsonl');
    // The way out: a script in a file is not read as a list of possible targets.
    expect(result.reason).toMatch(/script.*file|file.*script/i);
    expect(project().decide('node check.js').decision).toBe('allow');
  });

  it('negative: a string that does not match a state file is not a refusal', () => {
    const p = project();
    expect(p.decide(`node -e 'console.log("*")'`).decision).toBe('allow');
    expect(p.decide(`node -e 'const op="+";console.log(op)'`).decision).toBe('allow');
  });
});

describe('B245.C3: a literal state file keeps the state wording', () => {
  it.each([
    "sed -i 's/a/b/' openspec/changes/demo/.sdlc.yaml",
    'cp -R openspec/changes/demo out',
    'echo x > openspec/changes/demo/.sdlc.yaml',
    `node -e 'require("fs").writeFileSync("openspec/changes/demo/.sdlc.yaml","x")'`,
  ])('%s', (command) => {
    const result = project().decide(command);
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain('.sdlc.yaml');
    expect(result.reason).not.toMatch(/could not be resolved|cannot be resolved/i);
    expect(result.reason).not.toMatch(/Inline string|as a glob/);
  });
});

describe('review round 1: the reason names the part as it was written', () => {
  it.each([
    ['cp ${S}/a b', '${S}/a', /source/i],
    ['cp -R openspec/changes/${ID} out', 'openspec/changes/${ID}', /source/i],
    ['cp a.txt ${T}/b', '${T}/b', /destination/i],
    ['cp index.html "$T" 2>/dev/null', '$T', /destination/i],
    ['cp index.html "$T" | head', '$T', /destination/i],
    ['cp -t "$T" index.html', '$T', /destination/i],
  ])('%s', (command, part, role) => {
    const result = project().decide(command);
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain(part);
    expect(result.reason).toMatch(role);
  });

  it('a directory that cannot be resolved is named as the directory, not as a copy source', () => {
    const result = project().decide('cd "$X" && cp -r index.html b');
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason).toContain('$X');
    expect(result.reason).toMatch(/director/i);
    expect(result.reason).not.toContain('cp -r');
  });

  it('a reason stays short however long the part is', () => {
    const result = project().decide(`cp index.html "$T${'a'.repeat(5000)}"`);
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(result.reason?.length ?? 0).toBeLessThan(300);
    expect(result.reason).toContain('$T');
  });
});
