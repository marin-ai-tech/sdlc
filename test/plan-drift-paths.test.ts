import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedFiles, computePlanDrift } from '../src/core/plan-drift.js';
import { git as readGit } from '../src/core/git.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

describe('Exact plan-drift path evidence', () => {
  it('retains both rename endpoints, non-ASCII names and surrounding whitespace', () => {
    const root = tempDir('e20-drift-');
    initGitRepo(root);
    git(root, ['config', 'core.quotePath', 'true']);
    git(root, ['config', 'diff.renames', 'true']);
    write(path.join(root, 'src/old.ts'), 'old content');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'baseline']);
    const base = readGit(root, ['rev-parse', 'HEAD']).stdout;
    fs.renameSync(path.join(root, 'src/old.ts'), path.join(root, 'src/tést name.ts'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'rename']);
    write(path.join(root, 'src/ spaced.ts'), 'new');
    const names = ['src/old.ts', 'src/tést name.ts', 'src/ spaced.ts'].sort();
    expect(changedFiles(root, base)).toEqual(names);
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, 'plan.md'), '# Plan\n\n- `src/old.ts`\n- `src/tést name.ts`\n- `src/ spaced.ts`\n');
    const drift = computePlanDrift(root, dir, base);
    expect(drift.unplanned).toEqual([]);
    expect(drift.untouched).toEqual([]);
  });

  it('exposes Git listing failure instead of successful empty evidence', () => {
    expect(() => changedFiles(tempDir('e20-no-git-'), 'missing')).toThrow();
  });
});
