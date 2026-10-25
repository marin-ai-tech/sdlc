import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextMeCommand } from '../src/commands/next-me.js';
import { otherBranchChanges } from '../src/core/branch-changes.js';
import { printJson } from '../src/cli/output.js';

vi.mock('../src/cli/context.js', () => ({
  loadProject: () => ({ root: '/project', paths: {}, config: { cli: 'sdlc' } }),
}));
vi.mock('../src/core/changes.js', () => ({ listActiveChanges: () => [], resolveChange: vi.fn() }));
vi.mock('../src/core/my-queue.js', () => ({
  myQueue: () => ({ me: { email: null, person: null }, anyone: true, items: [] }),
}));
vi.mock('../src/core/branch-changes.js', () => ({ otherBranchChanges: vi.fn(() => []) }));
vi.mock('../src/cli/output.js', () => ({
  printJson: vi.fn(), line: vi.fn(), c: { bold: (value: string) => value },
  reportFailure: (error: unknown) => { throw error; },
}));

describe('B130: optional other-branch scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits otherBranches and never scans when branches is false', async () => {
    await nextMeCommand({ json: true, branches: false });
    expect(otherBranchChanges).not.toHaveBeenCalled();
    expect(printJson).toHaveBeenCalledOnce();
    expect(vi.mocked(printJson).mock.calls[0][0]).not.toHaveProperty('otherBranches');
  });

  it('keeps the existing output and scan by default', async () => {
    await nextMeCommand({ json: true });
    expect(otherBranchChanges).toHaveBeenCalledExactlyOnceWith('/project');
    expect(vi.mocked(printJson).mock.calls[0][0]).toHaveProperty('otherBranches', []);
  });
});
