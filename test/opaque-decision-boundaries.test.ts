import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChangeState, writeChangeState } from '../src/core/change-state.js';
import { assertGateWritable } from '../src/core/opaque-decisions.js';
import { parseOpenQuestions, withAnswer } from '../src/core/open-questions.js';
import { read, tempDir, write } from './helpers.js';

describe('Opaque boundary and wrapped-question controls', () => {
  it.each([
    ['intent', '  intent: # deliberately empty gate\n'],
    ['__proto__', '  __proto__: "opaque prototype key" # preserve only\n'],
    ['intent', '  # retained before gate\n  intent: "opaque" # retained after gate\n'],
  ])('retains raw trivia and refuses the malformed target %s', (gate, subtree) => {
    const dir = tempDir('sdlc-opaque-boundary-');
    const file = path.join(dir, '.sdlc.yaml');
    write(file, `version: 1\ngates:\n${subtree}history: []\n`);
    const state = readChangeState(dir);
    expect(() => assertGateWritable(state, 'demo', gate)).toThrow(/malformed/i);
    expect(state.gates.review).toBeUndefined();
    state.tests_locked = true;
    writeChangeState(dir, state);
    expect(read(file)).toContain(subtree);
  });

  it('places the answer after a complete lazy Markdown continuation as well as nested subitems', () => {
    const text = '## Open questions\n- Which receipts\nare required offline?\n  - Include copies.\n\n- Next?\n';
    const question = parseOpenQuestions(text)[0];
    expect(question.text).toBe('Which receipts are required offline?');
    const answered = withAnswer(text, question, '  - Answer (Pat, 2026-10-30): All.');
    expect(answered.indexOf('Answer (')).toBeGreaterThan(answered.indexOf('Include copies.'));
    expect(answered.indexOf('Answer (')).toBeLessThan(answered.indexOf('- Next?'));
  });
});
