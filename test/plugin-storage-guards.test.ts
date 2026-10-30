import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

function project() {
  const root = tempDir('sdlc-plugin-guards-');
  write(path.join(root, 'openspec/.sdlc/plugins/state/economy/store.json'), '{}');
  const ctx = { paths: projectPaths(root), config: defaultConfig() };
  const edit = (file: string) => evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, file) }, root), ctx);
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  return { root, edit, shell };
}

describe('Plugin storage shares core state guards', () => {
  it.each(['openspec/.sdlc/plugins/registry.json', 'openspec/.sdlc/plugins/state/economy/store.json',
    'openspec/.sdlc/plugins/activation.lock', 'openspec/.sdlc/log.lock'])('Direct storage write: %s', (file) => {
    expect(project().edit(file)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(['rm -rf openspec/.sdlc/plugins', 'rm -rf openspec/.sdlc',
    'echo bad > openspec/.sdlc/plugins/state/economy/store.json', 'rm openspec/.sdlc/plugins/state/*/*.json',
    'cd openspec/.sdlc/plugins/state/economy && echo bad > store.json'])('Parent/glob/relative write: %s', (command) => {
    expect(project().shell(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('Symlink/junction and hardlink aliases cannot write plugin state through another name', () => {
    const p = project();
    fs.symlinkSync(path.join(p.root, 'openspec/.sdlc/plugins'), path.join(p.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(p.edit('linked/state/economy/store.json')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    fs.linkSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), path.join(p.root, 'alias.json'));
    expect(p.edit('alias.json')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(p.shell('echo bad > alias.json')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(p.edit('ordinary.json').decision).not.toBe('deny');
  });
});
