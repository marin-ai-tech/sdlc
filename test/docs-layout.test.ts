import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT_ROLES } from '../src/core/layout.js';
import { REPO_ROOT } from './helpers.js';

const DOC = 'docs/en/07-ai-ready-project.md';
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');

describe(`documentation: ${DOC}`, () => {
  it('exists and describes every role of the layout with its canonical path and purpose', () => {
    const doc = read(DOC);
    for (const r of LAYOUT_ROLES) {
      expect(doc, r.path).toContain(`\`${r.path}\``);
    }
    expect(doc).toMatch(/AGENTS\.md/);
    expect(doc).toMatch(/@AGENTS\.md/);
  });

  it('documents the four layout commands, the adapt and convert modes, and the dashboard', () => {
    const doc = read(DOC);
    for (const cmd of ['sdlc layout check', 'sdlc layout scaffold', 'sdlc layout adapt', 'sdlc layout convert', 'sdlc report', 'sdlc dashboard']) {
      expect(doc, cmd).toContain(cmd);
    }
    expect(doc).toMatch(/--apply/);
    expect(doc).toMatch(/layout:/);
  });

  it('is linked from docs/en/README.md and the root README', () => {
    expect(read('docs/en/README.md')).toContain('07-ai-ready-project.md');
    expect(read('README.md')).toContain('docs/en/07-ai-ready-project.md');
  });

  it('negative: no Cyrillic, no CRLF', () => {
    const doc = read(DOC);
    expect(doc).not.toMatch(/[Ѐ-ӿ]/);
    expect(doc).not.toMatch(/\r/);
  });
});
