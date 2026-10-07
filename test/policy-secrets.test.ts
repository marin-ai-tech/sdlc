import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, type EnforcementMode } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B16: an agent's edit that adds a key, a token or a password is denied (rule `secret-in-edit`, a hard rule: it
 * holds in `warn` too). Built-in patterns, no entropy guessing. The reason names the kind of secret and the file,
 * never the value. Paths in `enforcement.secret_allow` (test data) are exempt. Removing a secret, or keeping one that
 * was already there, is not adding one.
 *
 * The sample secrets are assembled at run time, so this file itself carries none.
 */
const AWS = ['AK', 'IA', 'Z7Q2M4K9W1X8C3V6'].join('');
const GITHUB = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const GITLAB = ['gl', 'pat-', 'xY9zW8vU7tS6rQ5pO4nM'].join('');
const SLACK = ['xo', 'xb-', '1234567890-0987654321-AbCdEfGhIjKlMnOp'].join('');
const GOOGLE = ['AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join('');
const PEM = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('');
const OPENSSH = ['-----BEGIN ', 'OPENSSH PRIVATE KEY-----'].join('');
const DB_URL = ['postgres://app:', 'hunter2hunter2', '@db.internal:5432/claims'].join('');
const PASSWORD = ['password = "', 'S3cr3t-Value-2026', '"'].join('');

function project(mode: EnforcementMode = 'warn', allow: string[] = []) {
  const root = tempDir('sdlc-secrets-');
  write(path.join(root, 'src/config.js'), `export const region = 'eu';\nconst key = '${AWS}';\n`);
  const config = defaultConfig();
  config.enforcement.mode = mode;
  config.enforcement.requireApprovedPlan = false;
  config.enforcement.secretAllow = allow;
  const ctx = { paths: projectPaths(root), config };
  const call = (tool: string, input: Record<string, unknown>) =>
    evaluateToolCall(normalizeToolCall(tool, input, root), ctx);
  const writeFile = (file: string, content: string) => call('Write', { file_path: path.join(root, file), content });
  return { root, call, writeFile };
}

const DENY = { decision: 'deny', rule: 'secret-in-edit' };

describe('an agent edit that adds a secret', () => {
  it('is denied for each built-in kind, also in warn mode', () => {
    const p = project('warn');
    const samples = [AWS, GITHUB, GITLAB, SLACK, GOOGLE, `${PEM}\nMIIEow==\n`, `${OPENSSH}\nb3Bl\n`, DB_URL, PASSWORD];
    for (const sample of samples) {
      expect(p.writeFile('src/new.js', `const x = 1;\n${sample}\n`), sample.slice(0, 12)).toMatchObject(DENY);
    }
  });

  it('is denied through Edit, MultiEdit, a patch and a shell write', () => {
    const p = project('warn');
    const file = path.join(p.root, 'src/config.js');
    expect(p.call('Edit', { file_path: file, old_string: "'eu'", new_string: `'${GITHUB}'` })).toMatchObject(DENY);
    const edits = [{ old_string: "'eu'", new_string: "'us'" }, { old_string: 'region', new_string: PASSWORD }];
    expect(p.call('MultiEdit', { file_path: file, edits })).toMatchObject(DENY);
    const patch = ['*** Begin Patch', '*** Add File: src/keys.pem', `+${PEM}`, '+MIIEow==', '*** End Patch'].join('\n');
    expect(p.call('apply_patch', { patchText: patch })).toMatchObject(DENY);
    expect(p.call('Bash', { command: `printf '%s' '${SLACK}' > .slack-token` })).toMatchObject(DENY);
  });

  it('is reported by kind and file, never by value', () => {
    const p = project();
    const reason = p.writeFile('src/new.js', `const k = '${AWS}';\n`).reason ?? '';
    expect(reason).toContain('src/new.js');
    expect(reason).toMatch(/AWS/);
    expect(reason).not.toContain(AWS);
    expect(reason).not.toContain(AWS.slice(4));
  });
});

describe('negative: what is not adding a secret', () => {
  it('references, placeholders and short look-alikes', () => {
    const p = project('warn');
    const texts = [
      'password = "${DB_PASSWORD}"',
      'token: process.env.GITHUB_TOKEN',
      'password = "<your-password>"',
      'secret = "{{ vault.secret }}"',
      'API_KEY=',
      'const id = "AKIAEXAMPLE";',
      'postgres://app@db.internal:5432/claims',
      'postgres://app:${DB_PASSWORD}@db.internal:5432/claims',
      '-----BEGIN PUBLIC KEY-----',
    ];
    for (const text of texts) expect(p.writeFile('src/ok.js', `${text}\n`).decision, text).toBe('allow');
  });

  it('removing a secret, or keeping one that was already there', () => {
    const p = project('warn');
    const file = path.join(p.root, 'src/config.js');
    expect(p.call('Edit', { file_path: file, old_string: `'${AWS}'`, new_string: 'process.env.KEY' }).decision)
      .toBe('allow');
    expect(p.call('Edit', { file_path: file, old_string: "'eu'", new_string: "'us'" }).decision).toBe('allow');
    const current = fs.readFileSync(file, 'utf-8');
    expect(p.writeFile('src/config.js', current.replace("'eu'", "'us'")).decision).toBe('allow');
  });

  it('paths in enforcement.secret_allow, and enforcement off', () => {
    const allowed = project('block', ['test/fixtures/**']);
    expect(allowed.writeFile('test/fixtures/creds.txt', `${AWS}\n`).decision).toBe('allow');
    expect(allowed.writeFile('src/creds.txt', `${AWS}\n`)).toMatchObject(DENY);
    expect(project('off').writeFile('src/creds.txt', `${AWS}\n`).decision).toBe('allow');
  });
});

describe('enforcement.secret_allow in openspec/sdlc.yaml', () => {
  it('is read from the config file', () => {
    const root = tempDir('sdlc-secrets-config-');
    const file = path.join(root, 'openspec/sdlc.yaml');
    write(file, 'version: 1\nenforcement:\n  secret_allow:\n    - test/fixtures/**\n');
    expect(loadConfig(file).enforcement.secretAllow).toEqual(['test/fixtures/**']);
    write(file, 'version: 1\n');
    expect(loadConfig(file).enforcement.secretAllow).toEqual([]);
  });
});
