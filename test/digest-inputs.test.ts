import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestFiles, type DigestCapture } from '../src/core/digest.js';
import { SdlcError } from '../src/core/errors.js';
import { tempDir, write } from './helpers.js';

/**
 * B126 gaps (close-the-digest-integrity-review-findings): a digest reads only files that resolve inside the change
 * folder, both by path and by real path. A covered file outside it fails with `unsafe_path`; a covered file that is
 * missing or unreadable fails with `artifact_unreadable`. No digest is returned or captured in either case.
 * A junction needs no admin rights on Windows; elsewhere a directory symlink plays its part.
 */

function changeWithOutside(): { change: string; outside: string } {
  const root = tempDir('sdlc-digest-inputs-');
  const change = path.join(root, 'openspec', 'changes', 'demo');
  const outside = path.join(root, 'outside');
  write(path.join(change, 'intent.md'), '# Intent\n\nInside.\n');
  write(path.join(outside, 'intent.md'), '# Intent\n\nOutside the change.\n');
  return { change, outside };
}

function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof SdlcError ? error.code : `not an SdlcError: ${String(error)}`;
  }
  return undefined;
}

describe('B126 gap: unsafe and unreadable digest inputs', () => {
  it('refuses a covered file outside the change folder through .. and through a junction with unsafe_path', () => {
    const { change, outside } = changeWithOutside();
    linkDir(outside, path.join(change, 'linked'));
    expect(fs.readFileSync(path.join(change, 'linked', 'intent.md'), 'utf-8')).toMatch(/Outside/);
    const capture: DigestCapture = new Map();
    expect(codeOf(() => digestFiles(change, ['../../../outside/intent.md'], undefined, capture))).toBe('unsafe_path');
    expect(codeOf(() => digestFiles(change, ['linked/intent.md'], undefined, capture))).toBe('unsafe_path');
    expect(codeOf(() => digestFiles(change, ['intent.md', 'linked/intent.md'], undefined, capture)))
      .toBe('unsafe_path');
    // Negative: nothing was captured as a digest of the refused inputs.
    expect(capture.size).toBe(0);
  });

  it('negative: a covered file inside the change folder still gives a digest', () => {
    const { change } = changeWithOutside();
    const capture: DigestCapture = new Map();
    const digest = digestFiles(change, ['intent.md'], undefined, capture);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect([...capture.keys()]).toEqual([digest]);
  });

  it('refuses a missing covered file with artifact_unreadable', () => {
    const { change } = changeWithOutside();
    const capture: DigestCapture = new Map();
    expect(codeOf(() => digestFiles(change, ['missing.md'], undefined, capture))).toBe('artifact_unreadable');
    expect(codeOf(() => digestFiles(change, ['intent.md', 'missing.md'], undefined, capture)))
      .toBe('artifact_unreadable');
    fs.mkdirSync(path.join(change, 'folder.md'));
    expect(codeOf(() => digestFiles(change, ['folder.md'], undefined, capture))).toBe('artifact_unreadable');
    // Negative: no digest was captured for the refused inputs, and the error is not reported as unsafe_path.
    expect(capture.size).toBe(0);
  });
});
