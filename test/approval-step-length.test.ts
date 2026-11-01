import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

function oversized(text: string): string[] {
  const source = ts.createSourceFile('gates.ts', text, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && 'body' in node && node.body && ts.isBlock(node.body)) {
      const start = source.getLineAndCharacterOfPosition(node.body.getStart(source)).line;
      const end = source.getLineAndCharacterOfPosition(node.body.end).line;
      if (end - start - 1 > 30) failures.push(node.getText(source).split('\n')[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return failures;
}

describe('Structural approval steps', () => {
  it('all gate function bodies fit thirty physical lines, including nested functions', () => {
    expect(oversized(fs.readFileSync(path.join(REPO_ROOT, 'src/commands/gates.ts'), 'utf8'))).toEqual([]);
  });

  it('the structural ratchet detects an expanded risk-zone body', () => {
    const body = Array.from({ length: 31 }, (_, index) => `  line(${index});`).join('\n');
    expect(oversized(`function prepareApproval() {\n${body}\n}`)).toHaveLength(1);
  });

  it('release checks are a named cohesive step after artifact checks', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'src/commands/gates.ts'), 'utf8');
    const source = ts.createSourceFile('gates.ts', text, ts.ScriptTarget.Latest, true);
    const functions = source.statements.filter(ts.isFunctionDeclaration);
    const release = functions.find((node) => /release.*checks|checks.*release/i.test(node.name?.text ?? ''));
    expect(release).toBeDefined();
    const approve = functions.find((node) => node.name?.text === 'approveCommand')!.getText(source);
    expect(approve.indexOf(release!.name!.text)).toBeGreaterThan(approve.indexOf('checkApprovalArtifacts'));
  });
});
