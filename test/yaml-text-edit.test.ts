import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { editYamlText } from '../src/core/yaml-text-edit.js';

describe('YAML proposal text edits', () => {
  const base = [
    'version: 1',
    'signing: off # mode',
    'people:',
    '  pat:   { name: Pat, emails: [pat@example.com] }',
    'roles:',
    '  maintainer: [pat]',
    '',
  ].join('\r\n');

  it('keeps CRLF, comments and untouched flow formatting when replacing and adding keys', () => {
    const text = editYamlText(base, [
      'signing=warn',
      'signing_since=abc123',
      'people.pat.signing_key="ssh-ed25519 AAAA pat@example.com"',
    ]);
    expect(text).toContain('signing: warn # mode\r\n');
    expect(text).toContain('  pat:   { name: Pat, emails: [pat@example.com], signing_key:');
    expect(text).toContain('  maintainer: [pat]\r\n');
    expect(text).not.toMatch(/(?<!\r)\n/);
    expect(parse(text).signing_since).toBe('abc123');
  });

  it('quotes a value containing a comment marker and refuses multiline values', () => {
    const text = editYamlText(base, ['people.pat.name="Pat # One"']);
    expect(parse(text).people.pat.name).toBe('Pat # One');
    expect(() => editYamlText(base, ['people.pat.name="Pat\\nOne"'])).toThrow();
    expect(() => editYamlText(base, ['people.pat.name=|'])).toThrow();
  });

  it('adds a nested key to a block mapping without moving its following section', () => {
    const source = 'people:\n  pat:\n    name: Pat # keep\nroles:\n  maintainer: [pat]\n';
    const text = editYamlText(source, ['people.pat.emails=[pat@example.com]']);
    expect(text).toContain('    name: Pat # keep\n    emails: [pat@example.com]\nroles:');
    expect(parse(text).people.pat.emails).toEqual(['pat@example.com']);
  });

  it('adds a missing intermediate mapping on one new line', () => {
    const source = 'gates:\n  plan:\n    required: true\nverify:\n  commands: []\n';
    const text = editYamlText(source, ['gates.plan.auto_waive.kinds=[docs]']);
    expect(text).toContain('    auto_waive: { kinds: [docs] }\nverify:');
    expect(parse(text).gates.plan.auto_waive.kinds).toEqual(['docs']);
  });
});
