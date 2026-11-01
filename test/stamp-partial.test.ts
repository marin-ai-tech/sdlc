import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tryStampArtifacts } from '../src/core/stamp.js';
import { tempDir, read, write } from './helpers.js';

describe('Partial stamping', () => {
  it('retains the successful prefix and names every skipped attempt after drift', () => {
    const dir = tempDir('sdlc-stamp-partial-');
    for (const file of ['a.md', 'b.md', 'c.md']) write(path.join(dir, file), '# Artifact\n');
    let guards = 0;
    const result = tryStampArtifacts(dir, ['a.md', 'b.md', 'c.md'],
      { version: '0.29.0', license: 'community' }, () => {
        guards += 1;
        if (guards > 1) throw new Error('content drift');
      });
    expect(result.stamped).toEqual(['a.md']);
    expect(result).toMatchObject({ stampedCount: 1, skippedCount: 2 });
    expect(result).toHaveProperty('skipped', [
      { file: 'b.md', reason: 'content drift' }, { file: 'c.md', reason: 'content drift' },
    ]);
    expect(read(path.join(dir, 'a.md'))).toContain('sdlc-provenance');
    expect(read(path.join(dir, 'b.md'))).toBe('# Artifact\n');
    expect(read(path.join(dir, 'c.md'))).toBe('# Artifact\n');
  });
});
