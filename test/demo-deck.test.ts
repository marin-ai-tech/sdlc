import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, read, tempDir, write } from './helpers.js';

const BUILD = path.join(REPO_ROOT, 'scripts/demo/build-deck.mjs');
const CONTENT = path.join(REPO_ROOT, 'scripts/demo/deck-content.mjs');

interface Slide { id: string; layout: string; steps?: string[]; more?: string[]; title: Record<string, string> }
const load = async () => (await import(`file://${CONTENT.replace(/\\/g, '/')}`)) as {
  SLIDES: Slide[]; STEP_NOTE_RU: Record<string, string>; LANGS: string[];
};

/** Step ids the demo scenario records, read from the e2e test source. */
const scenarioSteps = () => [...read(path.join(REPO_ROOT, 'test/e2e-calculator.test.ts')).matchAll(/step\('([a-z0-9-]+)'/g)].map((m) => m[1]);

function fixture(dir: string): string {
  const ids = scenarioSteps();
  const refused = new Set(['roles-migrate', 'move-agent', 'track-agent', 'approve-intent-agent', 'approve-intent-bob', 'approve-review-bob', 'tests-unlock-agent']);
  const steps = ids.map((id, i) => ({
    id, section: 's', actor: ['alice', 'bob', 'carol', 'agent'][i % 4], command: `sdlc demo ${id} --flag value`,
    exit: refused.has(id) ? 1 : 0, output: refused.has(id) ? `error: refused ${id}` : `ok ${id}\n  line two of ${id}`, note: `Note for ${id}.`,
  }));
  const people = { alice: { name: 'Alice Ivanova', email: 'a@x' }, bob: { name: 'Bob Petrov', email: 'b@x' }, carol: { name: 'Carol Smirnova', email: 'c@x' } };
  const file = path.join(dir, 'transcript.json');
  write(file, JSON.stringify({ version: 1, generatedAt: '2026-09-30T00:00:00Z', people, steps }));
  return file;
}

const run = (args: string[]) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf-8' });

async function slideTexts(file: string): Promise<{ slides: string[]; notes: string[] }> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)![1]);
  const texts = async (re: RegExp) => Promise.all(Object.keys(zip.files).filter((n) => re.test(n)).sort((a, b) => num(a) - num(b))
    .map(async (n) => [...(await zip.file(n)!.async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ')));
  return { slides: await texts(/^ppt\/slides\/slide\d+\.xml$/), notes: await texts(/^ppt\/notesSlides\/notesSlide\d+\.xml$/) };
}

describe('demo deck (scripts/demo)', () => {
  it('the story only refers to steps the scenario records, and every step has a Russian note', async () => {
    const { SLIDES, STEP_NOTE_RU } = await load();
    const ids = new Set(scenarioSteps());
    const referenced = SLIDES.flatMap((s) => [...(s.steps ?? []), ...(s.more ?? [])]);
    expect(referenced.filter((id) => !ids.has(id))).toEqual([]);
    expect([...ids].filter((id) => !STEP_NOTE_RU[id])).toEqual([]);
  });

  it('builds an English and a Russian deck: one slide per story slide, titles and speaker notes in the language', async () => {
    const { SLIDES } = await load();
    const dir = tempDir('sdlc-deck-');
    const transcript = fixture(dir);
    for (const lang of ['en', 'ru']) {
      const out = path.join(dir, `deck.${lang}.pptx`);
      const r = run(['--transcript', transcript, '--lang', lang, '--out', out]);
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readFileSync(out).subarray(0, 2).toString()).toBe('PK');
      const { slides, notes } = await slideTexts(out);
      expect(slides).toHaveLength(SLIDES.length);
      SLIDES.forEach((s, i) => expect(slides[i]).toContain(s.title[lang].replace(/&/g, '&amp;')));
      expect(notes.join(' ')).toMatch(lang === 'ru' ? /[а-я]{4}/i : /the/i);
    }
  }, 60000);

  it('steps slides show the command, the actor and the output; the refusals slide lists every refused step', async () => {
    const dir = tempDir('sdlc-deck-');
    const out = path.join(dir, 'deck.pptx');
    expect(run(['--transcript', fixture(dir), '--lang', 'en', '--out', out]).status).toBe(0);
    const { slides } = await slideTexts(out);
    const all = slides.join('\n');
    expect(all).toContain('sdlc demo approve-intent-bob');
    expect(all).toContain('ok init');
    expect(all).toMatch(/Alice/);
    const refusals = slides.find((s) => s.includes('refused approve-review-bob') && s.includes('refused move-agent'))!;
    expect(refusals).toBeDefined();
    for (const id of ['move-agent', 'track-agent', 'approve-intent-agent', 'tests-unlock-agent']) expect(refusals).toContain(`sdlc demo ${id}`);
  }, 60000);

  it('negative: a missing transcript or a bad --lang fails with a message and exit 1 or 2', () => {
    const missing = run(['--transcript', path.join(tempDir('sdlc-deck-'), 'none.json'), '--lang', 'en', '--out', 'x.pptx']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/transcript/i);
    const lang = run(['--transcript', 'x.json', '--lang', 'de', '--out', 'x.pptx']);
    expect(lang.status).toBe(2);
    expect(lang.stderr).toMatch(/en|ru/);
  });
});
