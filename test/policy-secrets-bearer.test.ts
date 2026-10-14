import { describe, expect, it } from 'vitest';
import { addedSecretKinds, findSecrets } from '../src/core/policy-secrets.js';

/**
 * The same gap as in the MCP registry (0.20.3): an agent's edit could add `Authorization: "Bearer <token>"` with a
 * token of no known provider format, and the secret-in-edit rule did not see it. A credential of 20 or more
 * characters after `Bearer` or `Basic` is a secret now; references, placeholders and prose are not.
 */

describe('a literal credential after Bearer or Basic in an agent edit', () => {
  it('is found and denied as an added secret', () => {
    for (const text of [
      'headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" }',
      "fetch(url, { headers: { authorization: 'bearer zx81Qw7Lm2Np4Rt6Vy8Bc0Df' } })",
      'curl -H "Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Njc4"',
    ]) {
      expect(findSecrets(text).length, text).toBeGreaterThan(0);
      expect(addedSecretKinds(text, '')).toContain('bearer');
    }
  });

  it('negative: references, placeholders, short values and prose are not secrets', () => {
    for (const text of [
      'Authorization: `Bearer ${API_TOKEN}`',
      'headers: { Authorization: "Bearer " + process.env.API_TOKEN }',
      'Authorization: Bearer <your-token>',
      'Authorization: Bearer abc123',
      'Bearer tokens expire after an hour; Basic authentication sends the password.',
    ]) {
      expect(findSecrets(text), text).toEqual([]);
    }
  });

  it('negative: keeping a credential that was already there is not adding one', () => {
    const line = 'headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" }';
    expect(addedSecretKinds(`${line}\n// comment`, line)).toEqual([]);
  });
});
