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
  SLIDES: Slide[];
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
  it('the English story only refers to steps the scenario records', async () => {
    const { SLIDES } = await load();
    const ids = new Set(scenarioSteps());
    const referenced = SLIDES.flatMap((slide) => [...(slide.steps ?? []), ...(slide.more ?? [])]);
    expect(referenced.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('negative: no slide names a release version, and no slide outside the demo story a backlog id', async () => {
    const { SLIDES } = await load();
    const text = (slide: Slide) => JSON.stringify({ ...slide, steps: undefined, more: undefined });
    // sdlc releases are 0.x: two or three parts, with or without a v ("0.26", "v0.26.0").
    const release = /\bv?0\.\d+(?:\.\d+)?\b/g;
    const versions = SLIDES.flatMap((slide) => text(slide).match(release) ?? []);
    expect(versions).toEqual([]);
    const page = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/32-why-sdlc.md'), 'utf8');
    expect([...(page.match(release) ?? []), ...(page.match(/\b[BE]\d{1,3}\b/g) ?? [])]).toEqual([]);
    // Slides with demo steps tell the calculator's story, whose own backlog items (B1) belong to it.
    const outside = SLIDES.filter((slide) => !slide.steps && !slide.more);
    expect(outside.map((slide) => slide.id)).toEqual(expect.arrayContaining(['why', 'cost', 'closing']));
    const ids = outside.flatMap((slide) => text(slide).match(/\b[BE]\d{1,3}\b/g) ?? []);
    expect(ids).toEqual([]);
  });

  it('English slide titles fit on one line', async () => {
    const { SLIDES } = await load();
    expect(SLIDES.map((slide) => slide.title.en).filter((title) => title.length > 57)).toEqual([]);
  });

  it('builds the English deck with story slides and speaker notes', async () => {
    const { SLIDES } = await load();
    const dir = tempDir('sdlc-deck-');
    const out = path.join(dir, 'deck.en.pptx');
    const result = run(['--transcript', fixture(dir), '--lang', 'en', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(out).subarray(0, 2).toString()).toBe('PK');
    const { slides, notes } = await slideTexts(out);
    expect(slides).toHaveLength(SLIDES.length);
    SLIDES.forEach((slide, index) => expect(slides[index]).toContain(slide.title.en.replace(/&/g, '&amp;')));
    expect(notes.join(' ')).toMatch(/the/i);
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

  it('a missing transcript or an uninstalled deck language fails with a message and exit code', () => {
    const missing = run(['--transcript', path.join(tempDir('sdlc-deck-'), 'none.json'), '--lang', 'en', '--out', 'x.pptx']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/transcript/i);
    const language = run(['--transcript', 'x.json', '--lang', 'xx', '--out', 'x.pptx']);
    expect(language.status).toBe(2);
    expect(language.stderr).toMatch(/installed/i);
  });
});
