import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { qwenFolderTrusted } from '../src/core/qwen-trust.js';

const mock = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', () => ({ homedir: () => mock.home }));

const roots: string[] = [];
function project(): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.qwen-trust-test-'));
  roots.push(root);
  mock.home = root;
  fs.mkdirSync(path.join(root, '.qwen'));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Qwen folder trust', () => {
  it('denial wins when a child TRUST_PARENT has the same applicable depth', () => {
    const root = project();
    const folder = path.join(root, 'work');
    fs.writeFileSync(path.join(root, '.qwen/settings.json'), '{"security":{"folderTrust":{"enabled":true}}}');
    fs.writeFileSync(path.join(root, '.qwen/trustedFolders.json'), JSON.stringify({
      [folder]: 'DO_NOT_TRUST',
      [path.join(folder, 'child')]: 'TRUST_PARENT',
    }));
    expect(qwenFolderTrusted(path.join(folder, 'child'))).toBe(false);
  });

  it('accepts both JSON comment forms without treating settings as absent', () => {
    const root = project();
    fs.writeFileSync(path.join(root, '.qwen/settings.json'),
      '/* settings */ {"security": {"folderTrust": {"enabled": true}}} // enabled\n');
    fs.writeFileSync(path.join(root, '.qwen/trustedFolders.json'),
      `// no trusted folders\n{/* block */ "${root.replace(/\\/g, '\\\\')}": "DO_NOT_TRUST"}`);
    expect(qwenFolderTrusted(root)).toBe(false);
    expect(qwenFolderTrusted(path.join(root, 'elsewhere'))).toBe(false);
  });
});

describe('OpenSpec standalone change creation', () => {
  it.each(['sdlc openspec new change sneaky', 'openspec new change sneaky'])('%s is a soft process decision', (command) => {
    const root = project();
    const config = defaultConfig();
    config.enforcement.mode = 'block';
    const call = normalizeToolCall('Bash', { command }, root);
    const context = { paths: projectPaths(root), config };
    expect(evaluateToolCall(call, context)).toMatchObject({ decision: 'deny', rule: 'change-not-created' });
    expect(evaluateToolCall(call, context).reason).toContain('sdlc new sneaky');
    config.enforcement.mode = 'warn';
    expect(evaluateToolCall(call, context)).toMatchObject({ decision: 'warn', rule: 'change-not-created' });
  });
});
