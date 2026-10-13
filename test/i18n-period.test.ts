import { describe, expect, it } from 'vitest';
import { catalog, t } from '../src/core/i18n.js';

/**
 * The class of the judge's "..": a free text (a person's note, a reason, a judge's rework text) that ends with a
 * period, put right before the template's own period. Since 0.20.1 the substitution drops the value's trailing periods there.
 */

describe('a value before the template period', () => {
  it('a note that ends with a period does not produce two', () => {
    expect(t('next.takenOver', { by: 'Alice', note: 'I finish the copy.' }, 'en')).not.toContain('..');
    expect(t('next.qaRejected', { reason: 'The table misses a row.' }, 'en')).not.toContain('..');
    expect(t('next.takenOver', { by: 'Alice', note: 'Доделаю текст.' }, 'ru')).not.toContain('..');
  });

  it('negative: periods inside a value and a value not followed by a period stay as they are', () => {
    expect(t('next.takenOver', { by: 'Alice', note: 'v1.2 is out' }, 'en')).toContain('v1.2 is out.');
    expect(t('judge.rework', { rework: 'Add a scenario.' }, 'en')).toBe('Rework: Add a scenario.');
  });

  it('no catalog message of any locale puts a placeholder before two periods', () => {
    for (const locale of ['en', 'ru'] as const) {
      const bad = Object.entries(catalog(locale)).filter(([, text]) => /\}\.\.(?!\.)/.test(text)).map(([key]) => key);
      expect(bad, locale).toEqual([]);
    }
  });
});
