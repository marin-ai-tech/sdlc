import { describe, expect, it } from 'vitest';
import { parseExtensions } from '../src/plugins/api.js';

function nested(depth: number): any {
  let value: any = 'leaf';
  for (let i = 0; i < depth; i++) value = { child: value };
  return value;
}

describe('Independent guest payload depth', () => {
  it('supports depth32 within an extension namespace', () => {
    const value = nested(32);
    expect(parseExtensions({ economy: value })).toEqual({ economy: value });
  });

  it('refuses depth33 without changing either namespace value', () => {
    const value = { economy: nested(33), other: { keep: true } };
    const before = JSON.stringify(value);
    expect(() => parseExtensions(value)).toThrow(/complexity/);
    expect(JSON.stringify(value)).toBe(before);
  });
});
