import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preloadCli } from './audit-decision-preload.js';
import { decisionProject } from './e20-decision-fixture.js';

describe('Archive partial stamp reporting', () => {
  it('retains the ordinary archive result and reports a successful prefix before a real later I/O failure', () => {
    const p = decisionProject();
    const target = path.join(p.dir, 'intent.md');
    const script = ['const originalRename = fs.renameSync;', 'const originalWrite = fs.writeFileSync;',
      'fs.renameSync = function(from, to) {',
      `  if (String(to) === ${JSON.stringify(target)}) throw new Error('controlled stamp I/O refusal');`,
      '  return originalRename.apply(this, arguments);', '};', 'fs.writeFileSync = function(file) {',
      `  if (String(file) === ${JSON.stringify(target)}) throw new Error('controlled stamp I/O refusal');`,
      '  return originalWrite.apply(this, arguments);', '};'].join('\n');
    const out = preloadCli(p, ['archive', 'demo', '--yes', '--skip-specs', '--force', '--note', 'fixture', '--json'], script);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json().archive).toMatchObject({ change: 'demo', forced: true });
    expect(out.json().stamping).toMatchObject({ stamped: ['design.md'], stampedCount: 1, skippedCount: 5 });
    expect(out.json().stamping.skipped.map((item: { file: string }) => item.file))
      .toEqual(['intent.md', 'plan.md', 'proposal.md', 'review.md', 'tasks.md']);
    expect(out.json().stamping.skipped.every((item: { reason: string }) => /I\/O refusal/.test(item.reason))).toBe(true);
  }, 120000);
});
