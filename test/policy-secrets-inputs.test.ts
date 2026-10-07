import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, serializeConfig } from '../src/core/config.js';
import { patchWrites } from '../src/core/edit-texts.js';
import { setLocale } from '../src/core/i18n.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { findSecrets } from '../src/core/policy-secrets.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B16 beyond the lead's acceptance test: OpenCode inputs, unified diffs, renames and deletions, notebooks, the size
 * cap, look-alikes, the Russian reason and the saved config. The samples are assembled at run time, so this file
 * itself carries no secret.
 */
const AWS = ['AS', 'IA', 'QWERTY0123456789'].join('');
const GITHUB = ['gh', 's_', 'aB3'.repeat(12)].join('');
const LONG_VALUE = ['Zq9', '-xY7-', 'wV5uT3'].join('');

function project() {
  const root = tempDir('sdlc-secrets-inputs-');
  write(path.join(root, 'src/app.js'), `const region = 'eu';\nconst key = '${AWS}';\n`);
  const config = defaultConfig();
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config };
  const call = (tool: string, input: Record<string, unknown>) =>
    evaluateToolCall(normalizeToolCall(tool, input, root), ctx);
  return { root, call, file: path.join(root, 'src/app.js') };
}

afterEach(() => setLocale('en'));

describe('OpenCode inputs', () => {
  it('edit (oldString/newString) and write (content) are checked; removing a secret is not adding one', () => {
    const p = project();
    const added = { filePath: p.file, oldString: "'eu'", newString: `'${GITHUB}'` };
    expect(p.call('edit', added)).toMatchObject({ decision: 'deny', rule: 'secret-in-edit' });
    expect(p.call('edit', { filePath: p.file, oldString: `'${AWS}'`, newString: 'process.env.KEY' }).decision)
      .toBe('allow');
    expect(p.call('write', { filePath: path.join(p.root, 'src/n.js'), content: `x = '${AWS}'` }).decision).toBe('deny');
    const edits = [{ oldString: "'eu'", newString: `'${GITHUB}'` }];
    expect(p.call('MultiEdit', { filePath: p.file, edits }).decision).toBe('deny');
  });
});

describe('patches', () => {
  it('a unified diff: added lines count, a moved line does not', () => {
    const p = project();
    const head = ['--- a/src/app.js', '+++ b/src/app.js', '@@ -1,2 +1,2 @@'];
    const adds = [...head, "-const region = 'eu';", `+const token2 = '${GITHUB}';`].join('\n');
    expect(p.call('patch', { patch: adds })).toMatchObject({ decision: 'deny', rule: 'secret-in-edit' });
    const moves = [...head, `-const key = '${AWS}';`, `+export const key = '${AWS}';`].join('\n');
    expect(p.call('patch', { patch: moves }).decision).toBe('allow');
  });

  it('the envelope: per file, a rename writes to its new name, a deletion writes nothing', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.js',
      '*** Move to: src/b.js',
      '@@',
      '-old',
      `+${AWS}`,
      '*** Delete File: src/c.js',
      '*** Add File: src/d.js',
      '+plain',
      '*** End Patch',
    ].join('\n');
    expect(patchWrites(patch)).toEqual([
      { file: 'src/b.js', added: AWS, removed: 'old' },
      { file: 'src/d.js', added: 'plain', removed: '' },
    ]);
  });
});

describe('other edit tools and limits', () => {
  it('a notebook cell counts in full; a text over 1 MB is skipped', () => {
    const p = project();
    const notebook = path.join(p.root, 'nb.ipynb');
    expect(p.call('NotebookEdit', { notebook_path: notebook, new_source: `k = '${AWS}'` }).decision).toBe('deny');
    const big = `${'x'.repeat(1024 * 1024)}\n${AWS}\n`;
    expect(p.call('Write', { file_path: path.join(p.root, 'src/big.js'), content: big }).decision).toBe('allow');
  });

  it('a shell command without a write op is not checked', () => {
    const p = project();
    expect(p.call('Bash', { command: `echo ${AWS}` }).decision).toBe('allow');
    expect(p.call('Bash', { command: `echo ${AWS} >> notes.txt` }).decision).toBe('deny');
  });

  it('a file outside the project is not checked', () => {
    const p = project();
    const outside = path.join(tempDir('sdlc-secrets-outside-'), 'creds');
    expect(p.call('Write', { file_path: outside, content: `${AWS}\n` }).decision).toBe('allow');
  });
});

describe('assignments and look-alikes', () => {
  it('names that end in a secret word, in code and in JSON', () => {
    for (const text of [`DB_PASSWORD = "${LONG_VALUE}"`, `dbPassword: '${LONG_VALUE}'`,
      `"client_secret": "${LONG_VALUE}"`, `apiKey := "${LONG_VALUE}"`]) {
      expect(findSecrets(text).map((f) => f.kind), text).toEqual(['assignment']);
    }
  });

  it('types, short values, values with spaces, repeated characters and other names are not secrets', () => {
    for (const text of ['password: string', 'token = "short"', `passwords = "${LONG_VALUE}"`,
      'secret = "a value with spaces"', 'password = "************"', `maxTokens = "${LONG_VALUE}"`,
      'url = "https://user@example.com/x"', 'const key = process.env.AWS_KEY']) {
      expect(findSecrets(text), text).toEqual([]);
    }
  });
});

describe('the reason and the config', () => {
  it('the Russian reason names the kind and the file, not the value', () => {
    setLocale('ru');
    const p = project();
    const reason = p.call('Write', { file_path: path.join(p.root, 'src/n.js'), content: `${GITHUB}\n` }).reason ?? '';
    expect(reason).toMatch(/Секрет в src\/n\.js/);
    expect(reason).toMatch(/GitHub/);
    expect(reason).not.toContain(GITHUB.slice(4, 16));
  });

  it('secret_allow is saved back under its own name', () => {
    const config = parseConfig({ version: 1, enforcement: { secret_allow: ['test/fixtures/**'] } });
    const saved = serializeConfig(config) as { enforcement: Record<string, unknown> };
    expect(saved.enforcement.secret_allow).toEqual(['test/fixtures/**']);
  });
});
