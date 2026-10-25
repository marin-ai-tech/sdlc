import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approveCommand } from '../src/commands/gates.js';
import { defaultConfig } from '../src/core/config.js';
import { provenanceComment } from '../src/core/license.js';
import { initGitRepo, tempDir } from './helpers.js';
import { recordCheckpoint } from '../src/core/checkpoint.js';
import { tryStampArtifacts } from '../src/core/stamp.js';
import { recordChangeEvent } from '../src/cli/context.js';

const state = vi.hoisted(() => ({ root: '', digest: 'sha256:' + '1'.repeat(64), driftInChecks: true }));
vi.mock('../src/cli/context.js', () => ({
  loadProject: () => ({ root: state.root, paths: {}, config: defaultConfig(),
    stamp: { version: '0.26.0', license: 'community' } }),
  recordChangeEvent: vi.fn(),
}));
vi.mock('../src/core/changes.js', () => ({
  resolveChange: () => ({ id: 'demo', dir: state.root, archived: false }),
}));
vi.mock('../src/core/agent-env.js', () => ({ agentEnvironment: () => undefined }));
vi.mock('../src/core/roles.js', async (original) => ({
  ...await original<typeof import('../src/core/roles.js')>(), readRolesFile: () => undefined,
}));
vi.mock('../src/core/lifecycle.js', async (original) => ({
  ...await original<typeof import('../src/core/lifecycle.js')>(),
  evaluateChange: () => ({ change: 'demo', artifacts: [], gates: [
    { id: 'release', digest: state.digest, status: 'pending', missingRoles: [], artifacts: [] },
  ], next: { actor: 'none', action: 'none', message: '' } }),
}));
vi.mock('../src/core/awaiting.js', () => ({ recordAwaiting: vi.fn() }));
vi.mock('../src/core/checkpoint.js', () => ({ captureCheckpoint: vi.fn(), recordCheckpoint: vi.fn() }));
vi.mock('../src/core/stamp.js', () => ({
  changeMarkdown: () => [], tryStampArtifacts: vi.fn(() => ({ stamped: [] })),
}));
vi.mock('../src/mcp/release-checks.js', () => ({
  approvalChecks: async () => {
    if (state.driftInChecks) state.digest = 'sha256:' + '2'.repeat(64);
    return [];
  },
}));
vi.mock('../src/cli/next-hint.js', () => ({ resolveNext: () => undefined, emitNextHint: vi.fn() }));
vi.mock('../src/cli/output.js', () => ({
  c: {}, line: vi.fn(), warn: vi.fn(), printJson: vi.fn(),
  reportFailure: (error: unknown) => { throw error; },
}));

describe('B126 D3: slow checks cannot approve a different version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.root = tempDir('sdlc-approval-drift-');
    initGitRepo(state.root);
    state.digest = 'sha256:' + '1'.repeat(64);
    state.driftInChecks = true;
  });

  it('refuses drift before recording a checkpoint, approval or provenance stamp', async () => {
    await expect(approveCommand('release', { json: true })).rejects.toMatchObject({ code: 'digest_changed' });
    expect(recordCheckpoint).not.toHaveBeenCalled();
    expect(recordChangeEvent).not.toHaveBeenCalled();
    expect(tryStampArtifacts).not.toHaveBeenCalled();
  });

  it('refuses drift during a failed optional checkpoint before recording an approval', async () => {
    state.driftInChecks = false;
    vi.mocked(recordCheckpoint).mockImplementationOnce(() => {
      state.digest = 'sha256:' + '2'.repeat(64);
      return false;
    });
    await expect(approveCommand('release', { json: true })).rejects.toMatchObject({ code: 'digest_changed' });
    expect(recordCheckpoint).toHaveBeenCalledTimes(1);
    expect(recordChangeEvent).not.toHaveBeenCalled();
    expect(tryStampArtifacts).not.toHaveBeenCalled();
  });

  it('retains approval compatibility when an optional checkpoint is unavailable but content is unchanged', async () => {
    state.driftInChecks = false;
    vi.mocked(recordCheckpoint).mockReturnValueOnce(false);
    await expect(approveCommand('release', { json: true })).resolves.toBeUndefined();
    expect(recordChangeEvent).toHaveBeenCalledTimes(1);
  });
});
