import { describe, expect, it } from 'vitest';
import { assertCliValue } from '../src/core/cli-value.js';
import { SdlcError } from '../src/core/errors.js';

describe('cli program value', () => {
  it.each([
    'sdlc', 'sdlc.js', './bin/sdlc', 'npx --no-install sdlc', 'pnpm exec sdlc',
    'yarn sdlc', 'bunx sdlc', 'node C:/tools/sdlc.js', 'node ./bin/sdlc.js',
    'npx -y sdlc', 'npx --yes sdlc', 'npx --offline sdlc',
    'npx --no-install --offline sdlc', 'yarn exec sdlc',
  ])('accepts %s', (value) => {
    expect(() => assertCliValue(value, 'cli')).not.toThrow();
  });

  it.each([
    'sdlc waive --note', 'npx sdlc --locale en', 'sdlc waive intent --note sdlc',
    'sdlc --locale en ./sdlc', 'sdlc openspec x sdlc', 'true sdlc', 'zz sdlc',
    'npm exec sdlc', 'npx.cmd sdlc', 'sdlc  ', 'sdlc; echo bad',
    'node --version sdlc', 'node -v sdlc', 'node -e 0 sdlc', 'node -p 0 sdlc',
    'npx --version sdlc', 'yarn --version sdlc', 'pnpm --version sdlc',
    'bunx --version sdlc', 'pnpm dlx sdlc', 'npx -p @marin-ai/sdlc sdlc',
  ])('refuses %s with a fix', (value) => {
    let error: unknown;
    try {
      assertCliValue(value, 'cli');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SdlcError);
    expect((error as SdlcError).code).toBe('invalid_config');
    expect((error as SdlcError).fix).toContain('sdlc update');
  });
});
