import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Simulate a harness package whose files carry CRLF (a Windows checkout without
// .gitattributes, or a tarball packed from one): every file read from inside the
// package comes back with CRLF endings. Generated output must not depend on it.
vi.mock('../src/core/fs-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/fs-utils.js')>();
  // The repository root is the harness package root when tests run from source.
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  return {
    ...actual,
    readText: (target: string) => {
      const text = actual.readText(target);
      if (text === undefined || !path.resolve(target).startsWith(root)) return text;
      return text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
    },
  };
});

const { schemaFiles } = await import('../src/integrations/install.js');
const { renderClaudePlugin } = await import('../src/integrations/plugin.js');
const { readAsset } = await import('../src/integrations/assets.js');

const stamp = { tool: 'sdlc' as const, version: '0.0.0-test', license: 'community' };

describe('files copied from the harness package are emitted with LF', () => {
  it('schema and templates installed into openspec/schemas/sdlc/', () => {
    const files = schemaFiles(stamp);
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      expect(f.content.includes('\r'), f.path).toBe(false);
    }
  });

  it('plugin files, including the copied legal files', () => {
    for (const f of renderClaudePlugin()) {
      expect(f.content.includes('\r'), f.path).toBe(false);
    }
  });

  it('workflow assets', () => {
    expect(readAsset('workflows', 'plan.md').includes('\r')).toBe(false);
  });

  it('keeps content otherwise unchanged (no trimming of the final newline)', () => {
    const template = schemaFiles(stamp).find((f) => f.path.endsWith('templates/plan.md'))!;
    expect(template.content.endsWith('\n')).toBe(true);
    expect(template.content.length).toBeGreaterThan(0);
  });
});
