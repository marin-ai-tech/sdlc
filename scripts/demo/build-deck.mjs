/**
 * Builds the demo deck (.pptx) from a calculator e2e transcript and the story in deck-content.mjs.
 *
 *   node scripts/demo/build-deck.mjs --transcript <json> --lang en|ru --out <file.pptx>
 *
 * Text is fitted by font metrics (Courier New is 0.6 em per character; Calibri about 0.5 em),
 * so nothing relies on PowerPoint's autofit.
 */
import fs from 'node:fs';
import path from 'node:path';
import pptxgen from 'pptxgenjs';
import { ACTOR_LABEL, LANGS, ROLES, SLIDES, STAGES, STAGE_LABEL, STEP_NOTE_RU } from './deck-content.mjs';

const W = 13.33;
const H = 7.5;
const ML = 0.5;
const CW = W - 2 * ML;

const C = {
  graphite: '1F2430', deep: '161A22', paper: 'FFFFFF', ink: '1F2430', muted: '5B6475', line: 'C5CAD3',
  orange: 'F2A541', pass: '2FA66A', refused: 'D64545', tint: 'F3F5F8', out: 'E8EEF2',
};
const ACTOR_COLOR = { alice: '7C5CFF', bob: '2D8CFF', carol: '17A589', agent: 'F2A541' };
const ACTORS = ['alice', 'bob', 'carol', 'agent'];
/** pptxgenjs preset geometry names (the strings behind pres.shapes.*). */
const SHAPE = { round: 'roundRect', rect: 'rect', oval: 'ellipse', line: 'line' };
const MONO = 'Courier New';
const SANS = 'Calibri';
const SERIF = 'Cambria';

const USAGE = 'Usage: node scripts/demo/build-deck.mjs --transcript <json> --lang en|ru --out <file.pptx>\n';

function fail(message, code) {
  process.stderr.write(message);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--transcript', '--lang', '--out'].includes(argv[i]) || argv[i + 1] === undefined) fail(USAGE, 2);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.transcript || !args.out || !LANGS.includes(args.lang)) fail(`${USAGE}--lang is one of: en, ru\n`, 2);
  return args;
}

function loadTranscript(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`Cannot read the transcript ${file}: ${error.message}\n`, 1);
  }
}

// ---- text fitting -------------------------------------------------------

/** How many characters of a font fit in `w` inches at `pt` points. */
const fits = (w, pt, em) => Math.max(4, Math.floor((w * 72) / (pt * em)));

function cut(text, max) {
  const s = String(text ?? '').replace(/\r/g, '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Word-wraps into at most `rows` lines of `max` characters; the last line is cut with an ellipsis. */
function wrap(text, max, rows) {
  const lines = [''];
  for (const word of String(text).split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (!last) lines[lines.length - 1] = word;
    else if (`${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const kept = lines.slice(0, rows).map((line) => cut(line, max));
  if (lines.length > rows) kept[rows - 1] = cut(`${kept[rows - 1]} …`, max);
  return kept;
}

// ---- primitives ---------------------------------------------------------

function text(slide, value, opts) {
  slide.addText(value, { isTextBox: true, margin: 0, fontFace: SANS, color: C.ink, ...opts });
}

function box(slide, shape, x, y, w, h, fill, extra = {}) {
  slide.addShape(shape, { x, y, w, h, fill: { color: fill }, line: { color: fill }, ...extra });
}

function chip(slide, x, y, w, h, label, fill) {
  box(slide, SHAPE.round, x, y, w, h, fill, { rectRadius: h / 2 });
  text(slide, cut(label, fits(w - 0.1, 11, 0.55)), {
    x, y, w, h, fontSize: 11, bold: true, color: C.paper, align: 'center', valign: 'middle',
  });
}

function pill(slide, x, y, label, opts = {}) {
  const pt = opts.pt ?? 10;
  const w = Math.min(opts.maxW ?? 3, 0.24 + (label.length * pt * 0.52) / 72);
  box(slide, SHAPE.round, x, y, w, 0.28, opts.fill ?? C.tint, { rectRadius: 0.14 });
  text(slide, cut(label, fits(w - 0.16, pt, 0.52)), {
    x, y, w, h: 0.28, fontSize: pt, color: opts.color ?? C.muted, align: 'center', valign: 'middle',
  });
  return w;
}

/** Pills laid out left to right, wrapping; returns the y below the last row. */
function pillRows(slide, labels, x, y, right, opts = {}) {
  let px = x;
  let py = y;
  for (const label of labels) {
    const w = Math.min(opts.maxW ?? 3, 0.24 + (label.length * (opts.pt ?? 10) * 0.52) / 72);
    if (px + w > right) {
      px = x;
      py += 0.38;
    }
    if (opts.bottom && py + 0.28 > opts.bottom) break;
    px += pill(slide, px, py, label, opts) + 0.1;
  }
  return py + 0.38;
}

const actorShort = (actor, lang) => ACTOR_LABEL[actor][lang].split(' · ')[0];
const stepNote = (step, lang) => (lang === 'ru' ? STEP_NOTE_RU[step.id] ?? step.note : step.note) ?? '';
const refused = (step) => (step.exit ?? 0) !== 0;

// ---- the terminal card (the motif) --------------------------------------

function cardHeader(slide, x, y, w, step, lang) {
  const actor = ACTOR_COLOR[step.actor] ? step.actor : 'agent';
  chip(slide, x + 0.15, y + 0.15, Math.min(1.5, w * 0.4), 0.3, actorShort(actor, lang), ACTOR_COLOR[actor]);
  text(slide, `${refused(step) ? '✗' : '✓'} exit ${step.exit ?? 0}`, {
    x: x + w - 1.25, y: y + 0.15, w: 1.1, h: 0.3, fontSize: 11, bold: true,
    color: refused(step) ? C.refused : C.pass, align: 'right', valign: 'middle',
  });
}

/** A long output line continues on the next rows, indented by two spaces; breaks at a space when one is near. */
function hardWrap(line, max) {
  const rows = [];
  let rest = line;
  let width = max;
  while (rest.length > width) {
    const space = rest.lastIndexOf(' ', width);
    const at = space > width * 0.6 ? space : width;
    rows.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
    width = max - 2;
  }
  rows.push(rest);
  return rows.map((row, i) => (i ? `  ${row}` : row));
}

function outputLines(step, max, rows) {
  const lines = String(step.output ?? '').split('\n').filter((line) => line.trim());
  const wrapped = lines.flatMap((line) => hardWrap(line.replace(/^error:\s*/i, ''), max));
  const kept = wrapped.slice(0, rows);
  if (wrapped.length > rows) kept[rows - 1] = '…';
  return kept.length ? kept : ['(no output)'];
}

function terminalCard(slide, frame, step, lang) {
  const { x, y, w, h } = frame;
  box(slide, SHAPE.round, x, y, w, h, C.graphite, { rectRadius: 0.1 });
  cardHeader(slide, x, y, w, step, lang);
  const inner = w - 0.3;
  const command = wrap(`$ ${step.command}`, fits(inner, 11, 0.6), 2);
  const commandH = command.length * 0.2;
  text(slide, command.join('\n'), {
    x: x + 0.15, y: y + 0.58, w: inner, h: commandH, fontFace: MONO, fontSize: 11, color: C.orange, valign: 'top',
  });
  const outY = y + 0.7 + commandH;
  const rows = Math.max(1, Math.floor((y + h - 0.15 - outY) / 0.19));
  text(slide, outputLines(step, fits(inner, 10, 0.6), rows).join('\n'), {
    x: x + 0.15, y: outY, w: inner, h: y + h - 0.15 - outY, fontFace: MONO, fontSize: 10, color: C.out, valign: 'top',
  });
  const note = wrap(stepNote(step, lang), fits(w, 11, 0.5), 2);
  text(slide, note.join('\n'), {
    x, y: y + h + 0.08, w, h: 0.42, fontSize: 11, italic: true, color: C.muted, valign: 'top',
  });
}

// ---- the stepper --------------------------------------------------------

/** Circles for STAGES spread over [x, x + w]; returns the centre x of each stage. */
function stepper(slide, frame, highlight, lang, numbered) {
  const { x, y, w, d, pt } = frame;
  const gap = (w - STAGES.length * d) / (STAGES.length - 1);
  const centres = STAGES.map((_, i) => x + i * (d + gap) + d / 2);
  box(slide, SHAPE.rect, centres[0], y + d / 2 - 0.015, centres.at(-1) - centres[0], 0.03, C.line);
  STAGES.forEach((stage, i) => {
    const on = highlight.includes(stage);
    slide.addShape(SHAPE.oval, {
      x: centres[i] - d / 2, y, w: d, h: d,
      fill: { color: on ? C.orange : C.paper }, line: { color: on ? C.orange : C.line, width: 1.5 },
    });
    if (numbered) text(slide, String(i + 1), {
      x: centres[i] - d / 2, y, w: d, h: d, fontSize: 14, bold: true, color: C.paper, align: 'center',
      valign: 'middle',
    });
    text(slide, STAGE_LABEL[stage][lang], {
      x: centres[i] - (d + gap) / 2, y: y + d + 0.08, w: d + gap, h: 0.3, fontSize: pt, color: C.muted, align: 'center',
    });
  });
  return centres;
}

// ---- layouts ------------------------------------------------------------

function header(slide, def, lang, titleW = CW) {
  text(slide, def.title[lang], {
    x: ML, y: 0.35, w: titleW, h: 0.62, fontFace: SERIF, fontSize: 30, bold: true, valign: 'middle',
  });
  if (!def.lead) return;
  const lead = wrap(def.lead[lang], fits(CW, 14, 0.5), 2).join('\n');
  text(slide, lead, { x: ML, y: 1.05, w: CW, h: 0.5, fontSize: 14, color: C.muted, valign: 'top' });
}

function newSlide(pres, background) {
  const slide = pres.addSlide();
  slide.background = { color: background };
  return slide;
}

function notesFor(def, lang, shown = []) {
  const head = def.notes?.[lang] ?? def.lead?.[lang] ?? def.subtitle?.[lang] ?? def.points?.[lang]?.join(' ') ?? '';
  return [head, ...shown.map((step) => `${step.command} — ${stepNote(step, lang)}`)].filter(Boolean).join('\n');
}

function resolve(ids, steps) {
  return (ids ?? []).flatMap((id) => {
    const step = steps.get(id);
    if (!step) process.stderr.write(`warning: the transcript has no step "${id}"; its card is skipped\n`);
    return step ? [step] : [];
  });
}

function layoutTitle(pres, def, lang) {
  const slide = newSlide(pres, C.graphite);
  text(slide, 'sdlc', { x: ML, y: 0.5, w: 2, h: 0.4, fontSize: 18, bold: true, color: C.orange });
  text(slide, def.title[lang], {
    x: ML, y: 2.1, w: CW, h: 1.0, fontFace: SERIF, fontSize: 40, bold: true, color: C.paper,
  });
  text(slide, wrap(def.subtitle[lang], fits(CW * 0.8, 18, 0.5), 2).join('\n'), {
    x: ML, y: 3.25, w: CW * 0.8, h: 0.9, fontSize: 18, color: C.out, valign: 'top',
  });
  const w = (CW - 3 * 0.25) / 4;
  ACTORS.forEach((actor, i) => {
    chip(slide, ML + i * (w + 0.25), 6.2, w, 0.46, ACTOR_LABEL[actor][lang], ACTOR_COLOR[actor]);
  });
  slide.addNotes(notesFor(def, lang));
}

function personCard(slide, x, y, w, actor, lang, people) {
  box(slide, SHAPE.round, x, y, w, 2.25, C.tint, { rectRadius: 0.1 });
  box(slide, SHAPE.oval, x + (w - 0.6) / 2, y + 0.2, 0.6, 0.6, ACTOR_COLOR[actor]);
  const initial = actor === 'agent' ? 'AI' : people[actor]?.name?.[0] ?? actor[0].toUpperCase();
  text(slide, initial, {
    x: x + (w - 0.6) / 2, y: y + 0.2, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: C.paper, align: 'center',
    valign: 'middle',
  });
  const name = actor === 'agent' ? ACTOR_LABEL.agent[lang] : people[actor]?.name ?? actor;
  text(slide, name, { x: x + 0.1, y: y + 0.9, w: w - 0.2, h: 0.35, fontSize: 14, bold: true, align: 'center' });
  const none = lang === 'ru' ? 'без ролей: не утверждает' : 'no roles: never approves';
  const roles = ROLES[actor].length ? ROLES[actor] : [none];
  roles.forEach((role, i) => {
    box(slide, SHAPE.round, x + 0.2, y + 1.32 + i * 0.3, w - 0.4, 0.25, C.paper, { rectRadius: 0.12 });
    text(slide, role, {
      x: x + 0.2, y: y + 1.32 + i * 0.3, w: w - 0.4, h: 0.25, fontSize: 10, color: C.muted, align: 'center',
      valign: 'middle',
    });
  });
}

function layoutPeople(pres, def, lang, transcript) {
  const slide = newSlide(pres, C.paper);
  header(slide, def, lang);
  const w = (CW - 3 * 0.25) / 4;
  ACTORS.forEach((actor, i) => personCard(slide, ML + i * (w + 0.25), 1.75, w, actor, lang, transcript.people ?? {}));
  const shown = resolve(def.steps, transcript.byId);
  cardRow(slide, shown, lang, 4.3, 1.95);
  slide.addNotes(notesFor(def, lang, shown));
}

function cardRow(slide, shown, lang, y, h) {
  const gap = 0.3;
  const w = (CW - gap * (shown.length - 1)) / Math.max(1, shown.length);
  shown.forEach((step, i) => terminalCard(slide, { x: ML + i * (w + gap), y, w, h }, step, lang));
}

function flowGroup(slide, group, centres, lang) {
  const from = centres[STAGES.indexOf(group.from)];
  const to = centres[STAGES.indexOf(group.to)];
  const x = from - 0.45;
  const w = to - from + 0.9;
  box(slide, SHAPE.rect, x, 3.95, w, 0.03, C.orange);
  text(slide, group.label[lang], { x, y: 4.1, w, h: 0.35, fontSize: 15, bold: true, color: C.orange, align: 'center' });
  const lines = wrap(group.text[lang], fits(w, 12, 0.5), 4);
  text(slide, lines.join('\n'), { x, y: 4.5, w, h: 1.2, fontSize: 12, color: C.muted, align: 'center', valign: 'top' });
}

function layoutFlow(pres, def, lang) {
  const slide = newSlide(pres, C.paper);
  header(slide, def, lang);
  const centres = stepper(slide, { x: ML + 0.2, y: 2.35, w: CW - 0.4, d: 0.72, pt: 13 }, def.highlight, lang, true);
  for (const group of def.groups ?? []) flowGroup(slide, group, centres, lang);
  if (def.layer) layerNote(slide, def.layer[lang]);
  slide.addNotes(notesFor(def, lang));
}

/** A tinted band at the bottom of the flow slide: what lies underneath the process. */
function layerNote(slide, value) {
  box(slide, SHAPE.round, ML, 6.05, CW, 0.75, C.tint, { rectRadius: 0.1 });
  text(slide, wrap(value, fits(CW - 0.5, 14, 0.5), 2).join('\n'), {
    x: ML + 0.25, y: 6.05, w: CW - 0.5, h: 0.75, fontSize: 14, color: C.ink, valign: 'middle',
  });
}

function moreRow(slide, def, lang, steps) {
  const label = lang === 'ru' ? 'Также в этой части:' : 'Also in this part:';
  text(slide, label, { x: ML, y: 6.62, w: 1.9, h: 0.28, fontSize: 11, color: C.muted, valign: 'middle' });
  const names = [...new Set(resolve(def.more, steps).map((step) => step.name ?? step.command.replace(/^sdlc /, '')))];
  pillRows(slide, names, ML + 1.95, 6.62, W - ML, { bottom: 7.0 });
}

function layoutSteps(pres, def, lang, transcript) {
  const slide = newSlide(pres, C.paper);
  header(slide, def, lang, def.highlight ? CW - 5.2 : CW);
  if (def.highlight) stepper(slide, { x: W - ML - 4.9, y: 0.42, w: 4.9, d: 0.24, pt: 8 }, def.highlight, lang, false);
  const shown = resolve(def.steps, transcript.byId);
  cardRow(slide, shown, lang, 1.8, def.more ? 4.1 : 4.6);
  if (def.more?.length) moreRow(slide, def, lang, transcript.byId);
  slide.addNotes(notesFor(def, lang, shown));
}

function refusalRow(slide, step, frame, lang) {
  const { x, y, w } = frame;
  box(slide, SHAPE.round, x, y, w, 0.74, C.tint, { rectRadius: 0.08 });
  text(slide, '✗', {
    x: x + 0.12, y: y + 0.08, w: 0.3, h: 0.3, fontSize: 16, bold: true, color: C.refused, valign: 'middle',
  });
  chip(slide, x + 0.45, y + 0.09, 1.2, 0.28, actorShort(step.actor, lang), ACTOR_COLOR[step.actor] ?? C.orange);
  const cw = w - 1.85;
  text(slide, cut(step.command, fits(cw, 11, 0.6)), {
    x: x + 1.75, y: y + 0.08, w: cw, h: 0.3, fontFace: MONO, fontSize: 11, valign: 'middle',
  });
  const reason = String(step.output ?? '').split('\n').find((line) => line.trim()) ?? '';
  text(slide, cut(reason.replace(/^error:\s*/i, ''), fits(w - 0.6, 11, 0.5)), {
    x: x + 0.45, y: y + 0.42, w: w - 0.6, h: 0.26, fontSize: 11, color: C.refused, valign: 'middle',
  });
}

function layoutRefusals(pres, def, lang, transcript) {
  const slide = newSlide(pres, C.paper);
  header(slide, def, lang);
  const rows = transcript.steps.filter(refused).slice(0, 12);
  const w = (CW - 0.3) / 2;
  rows.forEach((step, i) => {
    const frame = { x: ML + (i % 2) * (w + 0.3), y: 1.8 + Math.floor(i / 2) * 0.86, w };
    refusalRow(slide, step, frame, lang);
  });
  slide.addNotes(notesFor(def, lang, rows));
}

function stat(slide, x, w, value, label) {
  box(slide, SHAPE.round, x, 1.8, w, 1.9, C.tint, { rectRadius: 0.1 });
  text(slide, String(value), {
    x, y: 1.9, w, h: 1.1, fontFace: SERIF, fontSize: 60, bold: true, color: C.orange, align: 'center',
    valign: 'middle',
  });
  text(slide, label, { x, y: 3.05, w, h: 0.4, fontSize: 16, align: 'center' });
}

function layoutCoverage(pres, def, lang, transcript) {
  const slide = newSlide(pres, C.paper);
  header(slide, def, lang);
  const used = new Set(transcript.steps.map((step) => step.name ?? step.command.split(' ')[1]));
  const all = transcript.commands ?? [...used];
  const covered = all.filter((name) => used.has(name)).length;
  const labels = lang === 'ru'
    ? ['шагов', `команд из ${all.length}`, 'отказов', 'человека (и агенты)']
    : ['steps', `of ${all.length} commands`, 'refusals', 'people (and agents)'];
  const people = Object.keys(transcript.people ?? {}).length;
  const values = [transcript.steps.length, covered, transcript.steps.filter(refused).length, people];
  const w = (CW - 3 * 0.25) / 4;
  values.forEach((value, i) => stat(slide, ML + i * (w + 0.25), w, value, labels[i]));
  pillRows(slide, all, ML, 4.1, W - ML, { bottom: 7.0, color: C.ink });
  slide.addNotes(notesFor(def, lang));
}

function layoutClosing(pres, def, lang) {
  const slide = newSlide(pres, C.graphite);
  text(slide, def.title[lang], {
    x: ML, y: 0.7, w: CW, h: 0.9, fontFace: SERIF, fontSize: 36, bold: true, color: C.paper,
  });
  def.points[lang].forEach((point, i) => {
    const y = 2.0 + i * 0.8;
    box(slide, SHAPE.oval, ML, y, 0.46, 0.46, C.orange);
    text(slide, String(i + 1), {
      x: ML, y, w: 0.46, h: 0.46, fontSize: 16, bold: true, color: C.graphite, align: 'center', valign: 'middle',
    });
    text(slide, point, {
      x: ML + 0.7, y: y - 0.05, w: CW - 0.7, h: 0.56, fontSize: 18, color: C.out, valign: 'middle',
    });
  });
  box(slide, SHAPE.round, ML, 4.95, CW, 1.1, C.deep, { rectRadius: 0.1 });
  const lines = def.reproduce.map((line) => cut(`$ ${line}`, fits(CW - 0.6, 13, 0.6)));
  text(slide, lines.join('\n'), {
    x: ML + 0.3, y: 5.2, w: CW - 0.6, h: 0.65, fontFace: MONO, fontSize: 13, color: C.orange, valign: 'top',
  });
  slide.addNotes(notesFor(def, lang));
}

const LAYOUTS = {
  title: layoutTitle, people: layoutPeople, flow: layoutFlow, steps: layoutSteps,
  refusals: layoutRefusals, coverage: layoutCoverage, closing: layoutClosing,
};

async function build(transcript, lang, out) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = lang === 'ru' ? 'sdlc · демо «калькулятор»' : 'sdlc · calculator demo';
  const steps = transcript.steps ?? [];
  const data = { ...transcript, steps, byId: new Map(steps.map((step) => [step.id, step])) };
  for (const def of SLIDES) {
    const layout = LAYOUTS[def.layout];
    if (!layout) fail(`Unknown layout "${def.layout}" in slide ${def.id}\n`, 1);
    layout(pres, def, lang, data);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await pres.writeFile({ fileName: out });
}

const args = parseArgs(process.argv.slice(2));
build(loadTranscript(args.transcript), args.lang, args.out).catch((error) => fail(`${error.stack ?? error}\n`, 1));
