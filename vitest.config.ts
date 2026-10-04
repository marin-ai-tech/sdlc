import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    // Output is English unless a test asks for a locale, whatever the machine's language.
    env: { SDLC_LOCALE: 'en' },
  },
});
