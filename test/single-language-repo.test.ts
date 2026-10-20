import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localesIn, resolveLocale } from '../src/core/i18n.js';
import { REPO_ROOT, tempDir } from './helpers.js';

/**
 * The repository carries one language, English. Other interface languages are installed locally: a catalog in
 * assets/locales/<code>.json (with its guide and role folders) is found at run time, and nothing tracked names a
 * second language. The patterns below are built from character codes so this file does not name one either.
 */

const BINARY = /\.(png|jpe?g|gif|ico|pptx|tgz|zip|pdf|mp4|woff2?)$/i;
const SECOND_SCRIPT = /[Ѐ-ӿ]/;
const CODE = String.fromCharCode(114, 117);
const LANGUAGE_NAME = new RegExp(String.fromCharCode(114, 117, 115, 115, 105, 97, 110), 'i');
const CODE_IN_TEXT = new RegExp(
  [`(['"\`])${CODE}\\1`, `/${CODE}/`, `\\b${CODE}\\.json\\b`, `\\b${CODE}[_-]${CODE.toUpperCase()}\\b`,
    `--locale[ =]${CODE}\\b`, `en, ${CODE}\\b`].join('|'),
);
const CODE_IN_PATH = new RegExp(`(^|[/._-])${CODE}([/._-]|$)`);

/** Tracked files still on disk (a file deleted in the working tree is on its way out of the index). */
function tracked(): string[] {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' });
  expect(listed.status).toBe(0);
  return listed.stdout.split('\0').filter((file) => file && fs.existsSync(path.join(REPO_ROOT, file)));
}

function textFiles(): { file: string; text: string }[] {
  return tracked()
    .filter((file) => !BINARY.test(file) && fs.existsSync(path.join(REPO_ROOT, file)))
    .map((file) => ({ file, text: fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8') }));
}

describe('one language in the repository', () => {
  it('no tracked text file contains a second script', () => {
    expect(textFiles().filter(({ text }) => SECOND_SCRIPT.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('no tracked text file names a second language or its locale code', () => {
    const named = textFiles()
      .filter(({ text }) => LANGUAGE_NAME.test(text) || CODE_IN_TEXT.test(text))
      .map(({ file }) => file);
    expect(named).toEqual([]);
  });

  it('only English catalogs, guide and role folders are tracked', () => {
    const files = tracked();
    expect(files.filter((f) => f.startsWith('assets/locales/'))).toEqual(['assets/locales/en.json']);
    const folders = (root: string) => [...new Set(files.filter((f) => f.startsWith(root)).map((f) => f.split('/')[2]))];
    expect(folders('assets/guide/')).toEqual(['en']);
    expect(folders('assets/roles/')).toEqual(['en']);
    expect(files.filter((f) => CODE_IN_PATH.test(f))).toEqual([]);
  });
});

describe('interface languages are found at run time', () => {
  it('lists English plus every catalog in a locales folder', () => {
    const dir = tempDir('sdlc-locales-');
    fs.writeFileSync(path.join(dir, 'en.json'), '{}');
    fs.writeFileSync(path.join(dir, 'xx.json'), '{}');
    fs.writeFileSync(path.join(dir, 'notes.txt'), '');
    expect(localesIn(dir)).toEqual(['en', 'xx']);
  });

  it('negative: an empty or missing folder still offers English', () => {
    expect(localesIn(tempDir('sdlc-locales-empty-'))).toEqual(['en']);
    expect(localesIn(path.join(tempDir('sdlc-locales-gone-'), 'none'))).toEqual(['en']);
  });

  it('negative: a language without an installed catalog falls back to English', () => {
    expect(resolveLocale({ flag: 'zz_ZZ.UTF-8', env: {} })).toBe('en');
    expect(resolveLocale({ flag: 'EN_us', env: {} })).toBe('en');
  });
});
