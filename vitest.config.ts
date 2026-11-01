import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import ExactShardSequencer from './scripts/test-shards.mjs';

const report = process.env.SDLC_TEST_REPORT;

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
    ...(report ? { reporters: ['default', 'json'], outputFile: { json: path.resolve(report) } } : {}),
    ...(process.env.SDLC_TEST_SHARD ? { sequence: { sequencer: ExactShardSequencer } } : {}),
  },
});
