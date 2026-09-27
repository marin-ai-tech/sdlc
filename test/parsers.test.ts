import { describe, expect, it } from 'vitest';
import { parseTasks } from '../src/core/tasks.js';
import { parseFindings, summarizeFindings } from '../src/core/review.js';
import { withoutCheckboxState } from '../src/core/digest.js';
import { plannedPaths } from '../src/core/plan-drift.js';

describe('parseTasks (OpenSpec-compatible semantics)', () => {
  it('counts only x/X as done and every other marker as open', () => {
    const p = parseTasks(['- [x] a', '- [X] b', '- [ ] c', '- [~] d', '- [] e', '* [ x] f', '1. [ ] g', '  - [x] nested'].join('\n'));
    expect(p.total).toBe(8);
    expect(p.complete).toBe(4);
    expect(p.remaining).toBe(4);
  });
  it('does not treat markdown link bullets as tasks', () => {
    expect(parseTasks('- [Docs](./docs.md)\n- [A](https://x)\n- [ ] real').total).toBe(1);
  });
});

describe('parseFindings', () => {
  const review = [
    '# Review',
    '### F1 [important][security] PII in logs',
    '- **Where**: src/a.ts:3',
    '- **Status**: open',
    '### F2 [nit][compliance] naming',
    '- **Status**: accepted (style)',
    '### F3 [important][bugs] off by one',
    '- **Status**: fixed (abc123)',
    '```',
    '### F9 [important][bugs] inside a fence is not a finding',
    '```',
  ].join('\n');
  it('parses severity, pass, status and location', () => {
    const findings = parseFindings(review);
    expect(findings.map((f) => [f.id, f.severity, f.pass, f.status])).toEqual([
      ['F1', 'important', 'security', 'open'],
      ['F2', 'nit', 'compliance', 'accepted'],
      ['F3', 'important', 'bugs', 'fixed'],
    ]);
    expect(findings[0].where).toBe('src/a.ts:3');
  });
  it('blocks only on open findings of blocking severities', () => {
    const s = summarizeFindings(parseFindings(review), ['important']);
    expect(s.blocking.map((f) => f.id)).toEqual(['F1']);
    expect(s.bySeverity.important).toEqual({ total: 2, open: 1 });
  });
});

describe('withoutCheckboxState', () => {
  it('neutralizes progress but keeps task text', () => {
    expect(withoutCheckboxState('- [x] 1.1 do it\n  * [X] sub\n1. [~] other')).toBe('- [ ] 1.1 do it\n  * [ ] sub\n1. [ ] other');
  });
  it('leaves links alone', () => {
    expect(withoutCheckboxState('- [Link](x)')).toBe('- [Link](x)');
  });
});

describe('plannedPaths', () => {
  it('extracts backticked and bare paths from plan.md', () => {
    const plan = '- `src/a.ts` (new)\n- tests in test/a.test.ts\n- `package.json`\n- see `sdlc verify` and `npm test`\n- dir `src/lib/`';
    expect(plannedPaths(plan)).toEqual(['package.json', 'src/a.ts', 'src/lib/', 'test/a.test.ts']);
  });
});
