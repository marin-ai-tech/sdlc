import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configModeIsOff } from '../src/hook-config.js';

describe('lenient mode read after config load failure', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hook-config-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['enforcement:\n  mode: off\n', true],
    ['enforcement:\n  mode: "off"\n', true],
    ['enforcement:\n  mode: OFF\n', false],
    ['enforcement:\n  mode: false\n', false],
    ['enforcement:\n  mode: warn\n', false],
    ['enforcement: {}\n', false],
    ['enforcement: off\n', false],
    ['cli: true sdlc\n', false],
    ['off\n', false],
    ['enforcement: [\n', false],
  ])('reads only exact off from %s', (yaml, expected) => {
    const file = path.join(dir, 'sdlc.yaml');
    fs.writeFileSync(file, yaml, 'utf8');
    expect(configModeIsOff(file)).toBe(expected);
  });

  it('treats an unreadable path as not off', () => {
    expect(configModeIsOff(dir)).toBe(false);
  });
});
