import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestFiles, withoutCheckboxState } from '../src/core/digest.js';
import { provenanceComment } from '../src/core/license.js';
import { tempDir, write } from './helpers.js';

describe('B127: return the exact normalized text used for a digest', () => {
  it('captures the hashed read even if the file changes before the read returns', () => {
    const root = tempDir('sdlc-digest-snapshot-');
    const stamp = provenanceComment({ version: '0.26.0', license: 'community' });
    const file = path.join(root, 'tasks.md');
    write(file, `# Tasks\r\n\r\n- [x] 1.1 Original\r\n\r\n${stamp}\r\n`);
    const capture = new Map();
    const digest = digestFiles(root, ['tasks.md'], (_rel, text) => {
      write(file, '# Tasks\n\n- [ ] 1.1 Replacement\n');
      return withoutCheckboxState(text);
    }, capture);
    const text = '# Tasks\n\n- [ ] 1.1 Original';
    const expected = 'sha256:' + createHash('sha256').update(`tasks.md\0${text}\0`).digest('hex');
    expect(digest).toBe(expected);
    expect(capture.get(digest)).toEqual({ digest, files: [{ path: 'tasks.md', text }] });
    expect(capture.get(digest).files[0].text).not.toContain('Replacement');
  });
});
