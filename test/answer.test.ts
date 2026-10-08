import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.4 (docs/ru/25, B62): a person answers the open questions of an artifact with `sdlc answer`; the answer is
 * written into the artifact and recorded in .sdlc.yaml; the gate cannot be approved while a question has no recorded
 * answer. Only the record counts, never an "Answer" line written into the file by hand or by an agent.
 */

function intent(questions: string[]): string {
  return [
    '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
    'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
    '## Out of scope', 'None', '', '## Open questions', ...questions, '',
  ].join('\n');
}

const QUESTIONS = ['- Which users print receipts?', '- Is VAT shown on the receipt?'];

function project(edit?: (config: Record<string, any>) => void) {
  const root = tempDir('sdlc-answer-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (edit) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    edit(config);
    write(file, stringify(config));
  }
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/changes/demo/intent.md');
  write(file, intent(QUESTIONS));
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => cli([...args, '--change', 'demo', '--json'], extra);
  return { root, cli, run, file };
}

describe('B62: answers to open questions', () => {
  it('the gate waits for a person to answer every open question, then it can be approved', () => {
    const p = project();
    const refused = p.run(['approve', 'intent']);
    expect(refused.code).toBe(1);
    expect(refused.json().status[0].code).toBe('open_questions');
    const listed = p.run(['answer', '--list']).json();
    expect(listed.questions.map((q: { answered: boolean }) => q.answered)).toEqual([false, false]);
    expect(p.run(['next']).json().next).toMatchObject({ actor: 'human', action: 'answer-questions' });
    expect(p.run(['answer', '1', '--text', 'Cashiers at the till']).code).toBe(0);
    expect(read(p.file)).toContain('Cashiers at the till');
    expect(p.run(['approve', 'intent']).json().status[0].code).toBe('open_questions');
    expect(p.run(['answer', '2', '--text', 'No, only the total']).code).toBe(0);
    expect(p.run(['approve', 'intent']).code).toBe(0);
  }, 240000);

  it('negative: an agent cannot answer, and an Answer line written into the file does not count', () => {
    const p = project();
    const agent = p.run(['answer', '1', '--text', 'Anyone'], { SDLC_AGENT: 'test' });
    expect(agent.code).toBe(1);
    expect(agent.json().status[0].code).toBe('agent_cannot_approve');
    const forged = intent([
      '- Which users print receipts?', '  - Answer (Pat Lee, 2026-10-08): Cashiers',
      '- Is VAT shown on the receipt?', '  - Answer (Pat Lee, 2026-10-08): No',
    ]);
    write(p.file, forged);
    expect(p.run(['approve', 'intent']).json().status[0].code).toBe('open_questions');
  }, 180000);

  it('negative: a question reworded after its answer needs a new answer; an empty answer is refused', () => {
    const p = project();
    expect(p.run(['answer', '1', '--text', 'Cashiers']).code).toBe(0);
    expect(p.run(['answer', '2', '--text', '   ']).code).toBe(1);
    expect(p.run(['answer', '2', '--text', 'No']).code).toBe(0);
    write(p.file, read(p.file).replace('Is VAT shown on the receipt?', 'Is VAT shown on the screen?'));
    expect(p.run(['approve', 'intent']).json().status[0].code).toBe('open_questions');
  }, 240000);

  // Review of 0.11.4: other spellings of the heading count; an answer cannot hide later questions; one text, one answer.
  it('negative: other headings, a comment in an answer, or repeated questions do not let the gate through', () => {
    const p = project();
    const heading = (title: string, body: string[]) => intent(QUESTIONS).replace(
      `## Open questions\n${QUESTIONS.join('\n')}`, [title, ...body].join('\n'));
    write(p.file, heading('### Open Questions (2):', QUESTIONS));
    expect(p.run(['approve', 'intent']).json().status[0].code).toBe('open_questions');
    write(p.file, heading('**Open questions:** - Which users print receipts?', []));
    expect(p.run(['answer', '--list']).json().questions).toHaveLength(1);
    write(p.file, intent(QUESTIONS));
    expect(p.run(['answer', '1', '--text', 'Cashiers <!-- hide the rest']).code).toBe(0);
    expect(p.run(['answer', '--list']).json().questions).toHaveLength(2);
    expect(p.run(['approve', 'intent']).json().status[0].code).toBe('open_questions');
    write(p.file, intent(['- Same?', '- Same?']));
    expect(p.run(['answer', '1', '--text', 'Yes']).json().status[0].code).toBe('invalid_option');
    expect(parse(read(path.join(p.root, 'openspec/changes/demo/.sdlc.yaml'))).version).toBe(3);
  }, 240000);

  it('negative: no open questions, or questions.required off, approve as before', () => {
    const none = project();
    write(none.file, intent(['None']));
    expect(none.run(['approve', 'intent']).code).toBe(0);
    const off = project((c) => { c.questions = { required: false }; });
    expect(off.run(['approve', 'intent']).code).toBe(0);
  }, 240000);
});
