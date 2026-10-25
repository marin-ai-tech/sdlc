import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readExecutors } from '../src/core/executors.js';
import { tempDir, write } from './helpers.js';

describe('B124: a runtime executor uses the ordinary registry permission boundary', () => {
  it('accepts a harness executor with provider-neutral capabilities and no embedded credentials', () => {
    const root = tempDir();
    write(path.join(root, 'openspec/executors.yaml'), [
      'version: 1', 'executors:', '  hosted:', '    type: harness', '    max_risk: medium',
      '    capabilities: [checkpoint, fork, credentialless-git]', '',
    ].join('\n'));
    expect(readExecutors(root)?.get('hosted')).toMatchObject({
      type: 'harness', maxRisk: 'medium', capabilities: ['checkpoint', 'fork', 'credentialless-git'],
    });
  });
});
