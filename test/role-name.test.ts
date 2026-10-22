import { describe, expect, it } from 'vitest';
import { assertCliValue } from '../src/core/config.js';
import { isRoleName } from '../src/core/role-name.js';

describe('role names', () => {
  it.each(['product-owner', 'tech_lead', 'qa.lead', 'engineer2'])('accepts %s', (name) => {
    expect(isRoleName(name)).toBe(true);
  });

  it.each(['', '2lead', '-x', 'product owner', 'a;b', 'x --change y'])('refuses %s', (name) => {
    expect(isRoleName(name)).toBe(false);
  });
});

describe('cli setting', () => {
  it.each([
    'sdlc',
    'npx --no-install sdlc',
    'pnpm exec sdlc',
    'node ./bin/sdlc.js',
    'node C:/tools/sdlc/bin/sdlc.js',
  ])('accepts %s', (value) => {
    expect(() => assertCliValue(value, '--cli')).not.toThrow();
  });

  it.each([
    'sdlc waive --note',
    'npx sdlc --locale en',
    'sdlc approve',
    'true',
    'sdlc  ',
  ])('refuses %s', (value) => {
    expect(() => assertCliValue(value, '--cli')).toThrow();
  });
});
