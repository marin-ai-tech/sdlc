import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/** B40: a file that shares its inode with a state file is that state file: editing it is a state write. */

function project() {
  const root = tempDir('sdlc-hardlink-');
  write(path.join(root, 'openspec/changes/demo/.sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'openspec/roles.yaml'), 'version: 1\n');
  const ctx = { paths: projectPaths(root), config: defaultConfig() };
  const edit = (file: string) => evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, file) }, root), ctx);
  return { root, edit };
}

describe('edits of a hard link to a state file', () => {
  it('are denied as state writes', () => {
    const p = project();
    fs.linkSync(path.join(p.root, 'openspec/changes/demo/.sdlc.yaml'), path.join(p.root, 'notes.yaml'));
    fs.linkSync(path.join(p.root, 'openspec/roles.yaml'), path.join(p.root, 'docs-roles.yaml'));
    expect(p.edit('notes.yaml')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(p.edit('docs-roles.yaml')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('negative: ordinary files and hard links between ordinary files stay editable', () => {
    const p = project();
    write(path.join(p.root, 'src/a.js'), 'a\n');
    fs.linkSync(path.join(p.root, 'src/a.js'), path.join(p.root, 'src/b.js'));
    write(path.join(p.root, 'docs/notes.md'), 'n\n');
    expect(p.edit('src/b.js').decision).not.toBe('deny');
    expect(p.edit('docs/notes.md').decision).not.toBe('deny');
    expect(p.edit('new-file.md').decision).not.toBe('deny');
  });
});
