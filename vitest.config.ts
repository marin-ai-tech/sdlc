import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    // One temporary root per run, removed at its end (test/global-setup.ts).
    globalSetup: ['test/global-setup.ts'],
    // Output is English unless a test asks for a locale, whatever the machine's language.
    env: { SDLC_LOCALE: 'en' },
  },
});
