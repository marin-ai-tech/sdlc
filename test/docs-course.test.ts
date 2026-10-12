import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * The two versions of the user course (docs/en/course for video, docs/en/handbook for reading) cover the same
 * modules, and a "Gaps found" / "Known limitations" section is never left as a bare heading
 * (0.15.2: three handbook chapters had lost their lists while the course kept them).
 */

const COURSE = path.join(REPO_ROOT, 'docs/en/course');
const HANDBOOK = path.join(REPO_ROOT, 'docs/en/handbook');
const LIST_HEADINGS = /^## (Gaps found|Known limitations)\s*$/;

function modules(dir: string): string[] {
  return fs.readdirSync(dir).filter((file) => /^\d\d-.+\.md$/.test(file)).sort();
}

/** The body of each list section: the lines between its heading and the next `## ` heading. */
function listSections(file: string): string[][] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const sections: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (LIST_HEADINGS.test(line)) {
      current = [];
      sections.push(current);
    } else if (line.startsWith('## ')) {
      current = undefined;
    } else if (current) {
      current.push(line);
    }
  }
  return sections;
}

describe('the user course and the handbook', () => {
  it('cover the same modules', () => {
    expect(modules(HANDBOOK)).toEqual(modules(COURSE));
  });

  it('never leave a gaps or limitations section empty', () => {
    const empty: string[] = [];
    for (const dir of [COURSE, HANDBOOK]) {
      for (const file of modules(dir)) {
        const sections = listSections(path.join(dir, file));
        const where = path.relative(REPO_ROOT, path.join(dir, file));
        sections.forEach((body) => {
          if (!body.some((line) => /^(-|\d+\.) /.test(line))) empty.push(where);
        });
      }
    }
    expect(empty).toEqual([]);
  });

  it('number the items of a numbered gaps list without holes', () => {
    const holes: string[] = [];
    for (const dir of [COURSE, HANDBOOK]) {
      for (const file of modules(dir)) {
        for (const body of listSections(path.join(dir, file))) {
          const numbers = body.map((line) => /^(\d+)\. /.exec(line)?.[1]).filter(Boolean).map(Number);
          if (numbers.some((value, index) => value !== index + 1)) holes.push(file);
        }
      }
    }
    expect(holes).toEqual([]);
  });
});
