import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { decisionProject } from './e20-decision-fixture.js';
import { read, runCli, tempDir, write } from './helpers.js';

const ANSWER = 'Cashiers say "Hi"; $HOME $(Write-Output BAD) `ticks` & | stays literal.';

function project() {
  const p = decisionProject();
  const file = path.join(p.dir, 'intent.md');
  write(file, read(file).replace('## Open questions\nNone', '## Open questions\n- Which users print receipts?'));
  return p;
}

describe('Answer file boundary', () => {
  it('records a plain UTF8 answer file literally and retains ordinary answer normalization', () => {
    const p = project();
    write(path.join(p.root, '.sdlc-answer.txt'), `  ${ANSWER}\nSecond line.  `);
    const out = p.cli(['answer', '1', '--change', 'demo', '--text-file', '.sdlc-answer.txt', '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json().answer).toBe(`${ANSWER} Second line.`);
    expect(parse(read(p.stateFile)).answers[0].answer).toBe(`${ANSWER} Second line.`);
    expect(read(path.join(p.dir, 'intent.md'))).toContain(`${ANSWER} Second line.`);
  }, 120000);

  it('refuses --text with --text-file before recording an answer', () => {
    const p = project();
    const before = read(p.stateFile);
    write(path.join(p.root, 'answer.txt'), ANSWER);
    const out = p.cli(['answer', '1', '--change', 'demo', '--text', 'other', '--text-file', 'answer.txt', '--json']);
    expect(out.code).toBe(1);
    expect(out.json().status[0].code).toBe('invalid_option');
    expect(read(p.stateFile)).toBe(before);
  }, 120000);

  it('rejects agent authority before inspecting a missing answer file', () => {
    const p = project();
    const before = read(p.stateFile);
    const out = runCli(['answer', '1', '--change', 'demo', '--text-file', 'missing.txt', '--json'],
      p.root, { ...p.env, SDLC_AGENT: 'reader' });
    expect(out.code).toBe(1);
    expect(out.json().status[0].code).toBe('agent_cannot_approve');
    expect(read(p.stateFile)).toBe(before);
  }, 120000);

  it('list ignores the answer-file input and remains read-only', () => {
    const p = project();
    const before = read(p.stateFile);
    const out = p.cli(['answer', '--list', '--change', 'demo', '--text-file', 'missing.txt', '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json().questions).toHaveLength(1);
    expect(read(p.stateFile)).toBe(before);
  }, 120000);

  it.each(['outside', 'linked', 'directory', 'large', 'invalid-utf8'])('refuses %s file inputs without mutation', (kind) => {
    const p = project();
    const outside = path.join(tempDir('sdlc-outside-answer-'), 'outside.txt');
    write(outside, ANSWER);
    let input = outside;
    if (kind === 'linked') {
      const link = path.join(p.root, 'linked');
      fs.symlinkSync(path.dirname(outside), link, process.platform === 'win32' ? 'junction' : 'dir');
      input = 'linked/outside.txt';
    }
    if (kind === 'directory') input = 'openspec';
    if (kind === 'large') {
      input = 'large.txt';
      write(path.join(p.root, input), 'x'.repeat(64 * 1024 + 1));
    }
    if (kind === 'invalid-utf8') {
      input = 'invalid.txt';
      fs.writeFileSync(path.join(p.root, input), Buffer.from([0xc3, 0x28]));
    }
    const before = read(p.stateFile);
    const out = p.cli(['answer', '1', '--change', 'demo', '--text-file', input, '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0].code).not.toBe('unknown_option');
    expect(JSON.stringify(out.json())).not.toContain(ANSWER);
    expect(read(p.stateFile)).toBe(before);
  }, 120000);
});
