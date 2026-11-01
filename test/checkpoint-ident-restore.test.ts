import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { checkpointScope, recordCheckpoint, restoreFromCheckpoint } from '../src/core/checkpoint.js';
import { digestFiles } from '../src/core/digest.js';
import { git, initGitRepo, read, tempDir, write } from './helpers.js';

describe('Actual Git ident checkpoint restore', () => {
  it('restores the evaluated ident expansion and CRLF bytes from a legitimate autocrlf=true checkout', () => {
    const root = tempDir('sdlc-ident-restore-');
    initGitRepo(root);
    git(root, ['config', 'core.autocrlf', 'true']);
    const artifact = 'openspec/changes/demo/intent.md';
    const file = path.join(root, artifact);
    write(path.join(root, '.gitattributes'), `${artifact} ident\n`);
    write(file, '# Intent\n\nRevision: $Id$\n\nBody.\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'artifact']);
    fs.rmSync(file);
    git(root, ['checkout', '--', artifact]);
    const evaluated = read(file);
    expect(evaluated).toContain('\r\n');
    expect(evaluated).toMatch(/\$Id: [0-9a-f]{40,64} \$/);
    const dir = path.dirname(file);
    const capture = new Map();
    const digest = digestFiles(dir, ['intent.md'], undefined, capture);
    expect(recordCheckpoint(root, 'demo', 'intent', (snapshot) => {
      assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md');
    }, [artifact])).toBe(true);
    const raw = spawnSync('git', ['cat-file', 'blob', `refs/sdlc/demo/intent:${artifact}`],
      { cwd: root, encoding: 'utf8', timeout: 30000 }).stdout;
    expect(raw).toContain('$Id$');
    expect(raw).toContain('\r\n');
    write(file, 'Changed after approval.\n');
    const scope = checkpointScope(root, 'refs/sdlc/demo/intent', [artifact], 'openspec/changes/demo', [])!;
    expect(restoreFromCheckpoint(scope)).toContain(artifact);
    expect(read(file)).toBe(evaluated);
  });
});
