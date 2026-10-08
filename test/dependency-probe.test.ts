import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeProbe, onSearchPath } from '../src/core/dependencies.js';
import { tempDir } from './helpers.js';

/**
 * B44 (0.11.3): `sdlc doctor` said "not on PATH" for codegraph and the OpenSpec CLI on a loaded machine. The probe
 * runs `<tool> --version`, and a tool that did not answer within the timeout was reported as missing. A slow tool
 * that is on PATH is found (its version may stay unknown); a tool that is not on PATH is still missing.
 */
describe('dependency probe', () => {
  it('a tool on PATH that answers too slowly is found, not missing', () => {
    const dir = tempDir('sdlc-probe-');
    const script = path.join(dir, 'slow.js');
    fs.writeFileSync(script, 'setTimeout(() => {}, 5000);\n');
    const result = makeProbe(300)('node', [script], dir);
    expect(result.ok, result.output).toBe(true);
  }, 30000);

  it('negative: a tool that is not on PATH is missing', () => {
    const dir = tempDir('sdlc-probe-');
    expect(makeProbe(300)('sdlc-no-such-tool-xyz', ['--version'], dir).ok).toBe(false);
  }, 30000);

  // Review of 0.11.3: Windows allows quoted PATH entries, and `cli` may be a path rather than a name.
  it('a quoted PATH entry and a command given as a path are found', () => {
    const dir = tempDir('sdlc-probe-path-');
    const name = process.platform === 'win32' ? 'sdlc-fake-tool.cmd' : 'sdlc-fake-tool';
    fs.writeFileSync(path.join(dir, name), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
    fs.chmodSync(path.join(dir, name), 0o755);
    expect(onSearchPath('sdlc-fake-tool', { ...process.env, PATH: `"${dir}"`, Path: `"${dir}"` })).toBe(true);
    expect(onSearchPath(path.join(dir, 'sdlc-fake-tool'), { ...process.env, PATH: '', Path: '' })).toBe(true);
    expect(onSearchPath('sdlc-fake-tool', { ...process.env, PATH: '', Path: '' })).toBe(false);
  });

  it('negative: a tool that answers in time reports its output', () => {
    const dir = tempDir('sdlc-probe-');
    const result = makeProbe(20000)('node', ['--version'], dir);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/\d+\.\d+\.\d+/);
  }, 30000);
});
