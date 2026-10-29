import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';
import { proseLines } from './docs-markdown.js';

/**
 * Readability rules for the published documentation, applied as a ratchet: a page is listed in CONVERTED once it is
 * rewritten, and from then on it keeps the rules. A page states the present behaviour (no version history, no
 * backlog ids), opens with what it is about, gives a long page an outline and links onward, and puts enumerations
 * into lists instead of long comma-separated sentences.
 */

const CONVERTED = [
  'README.md',
  'docs/en/README.md',
  'docs/en/glossary.md',
  'docs/en/13-process-health.md',
  'docs/en/05-guide.md',
  'docs/en/04-architecture.md',
  'docs/en/07-ai-ready-project.md',
  'docs/en/08-roles-and-signing.md',
  'docs/en/14-traceability.md',
  'docs/en/10-integrations.md',
  'docs/en/11-mcp-use-cases.md',
  'docs/en/12-agent-team.md',
  'docs/en/09-demo-and-automation.md',
  'docs/en/15-cursor.md',
  'docs/en/16-codex.md',
  'docs/en/17-qwen-gigacode.md',
  'docs/en/01-openspec-analysis.md',
  'docs/en/02-sdlc-playbook.md',
  'docs/en/03-landscape-and-reviews.md',
  'docs/en/06-openspec-upstream.md',
  'docs/en/handbook/README.md',
  'docs/en/course/README.md',
  'docs/en/handbook/00-introduction.md',
  'docs/en/course/00-introduction.md',
  'docs/en/handbook/01-setup-greenfield.md',
  'docs/en/course/01-setup-greenfield.md',
  'docs/en/handbook/02-toolchain-mcp.md',
  'docs/en/course/02-toolchain-mcp.md',
  'docs/en/handbook/03-roles-and-team.md',
  'docs/en/course/03-roles-and-team.md',
  'docs/en/handbook/04-backlog.md',
  'docs/en/course/04-backlog.md',
  'docs/en/handbook/05-lifecycle-greenfield.md',
  'docs/en/course/05-lifecycle-greenfield.md',
  'docs/en/handbook/06-developer.md',
  'docs/en/course/06-developer.md',
  'docs/en/handbook/07-qa-review-release.md',
  'docs/en/course/07-qa-review-release.md',
  'docs/en/handbook/08-brownfield.md',
  'docs/en/course/08-brownfield.md',
  'docs/en/handbook/09-management-and-audit.md',
  'docs/en/course/09-management-and-audit.md',
  'docs/en/handbook/10-multi-agent.md',
  'docs/en/course/10-multi-agent.md',
  'docs/en/handbook/11-troubleshooting-and-reference.md',
  'docs/en/course/11-troubleshooting-and-reference.md',
  'docs/en/18-team-example.md',
  'docs/en/19-team-greenfield-example.md',
  'docs/en/20-onboarding-example.md',
  'docs/en/21-dashboard-health-example.md',
  'docs/en/22-adopt-large-codebase-example.md',
  'docs/en/23-tracks-and-decisions-example.md',
  'docs/en/24-bugfix-incident-example.md',
  'docs/en/25-ci-release-upgrade-example.md',
  'docs/en/26-signed-audit-example.md',
  'docs/en/27-mcp-integrations-example.md',
  'docs/en/28-executor-swarm-example.md',
  'docs/en/29-mixed-tools-example.md',
  'docs/en/30-finishing-with-executors-example.md',
  'docs/en/32-why-sdlc.md',
];

const LONG_PAGE_WORDS = 800;
const OPENING_MAX_WORDS = 70;
const SENTENCE_MAX_WORDS = 45;
const SENTENCE_MAX_COMMAS = 4;
const MERMAID_TYPES = /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|block-beta)\b/;

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

/** Prose without inline code, so commands and paths do not count as words, versions or commas. */
function plain(line: string): string {
  return line.replace(/`[^`]*`/g, 'CODE').replace(/\]\([^)]*\)/g, ']');
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Paragraphs: runs of plain prose lines (no headings, list items, tables, quotes or HTML). */
function paragraphs(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let current: { line: number; text: string } | undefined;
  for (const { line, text: raw } of proseLines(text)) {
    const prose = raw.trim() !== '' && !/^\s*(#|[-*+]\s|\d+[.)]\s|\||>|<|!\[)/.test(raw) && !/^\s{2,}\S/.test(raw);
    if (!prose) {
      current = undefined;
      continue;
    }
    if (current) current.text += ` ${raw.trim()}`;
    else out.push((current = { line, text: raw.trim() }));
  }
  return out;
}

function sentences(paragraph: string): string[] {
  return plain(paragraph).split(/(?<=[.!?])\s+(?=[A-Z])/);
}

function versionMentions(text: string): string[] {
  const found: string[] = [];
  for (const { line, text: raw } of proseLines(text)) {
    const prose = plain(raw);
    const hits = [
      ...prose.matchAll(/\b(?:since|from|as of|until|before|after|in|up to|starting with)\s+v?\d+\.\d+(?:\.\d+)?\b/gi),
      ...prose.matchAll(/\bv?0\.\d{1,2}\.\d{1,2}\b/g),
      ...prose.matchAll(/\b[BE]\d{1,3}\b/g),
    ];
    for (const m of hits) found.push(`${line}: ${m[0]}`);
  }
  return found;
}

function openingProblem(text: string): string | undefined {
  const lines = proseLines(text).filter((l) => l.text.trim() !== '');
  if (!/^#\s/.test(lines[0]?.text ?? '')) return 'the page does not start with a "# " title';
  const first = paragraphs(text)[0];
  const next = lines[1];
  if (!first || !next || first.line !== next.line) return 'the title is not followed by a paragraph about the page';
  if (words(plain(first.text)) > OPENING_MAX_WORDS) return `the opening paragraph has over ${OPENING_MAX_WORDS} words`;
  return undefined;
}

function outlineProblems(text: string): string[] {
  if (words(proseLines(text).map((l) => plain(l.text)).join(' ')) <= LONG_PAGE_WORDS) return [];
  const headings = proseLines(text).map((l) => l.text);
  const problems: string[] = [];
  if (!headings.some((h) => /^##\s+.*On this page\s*$/i.test(h))) problems.push('no "## On this page" outline');
  if (!headings.some((h) => /^##\s+.*See also\s*$/i.test(h))) problems.push('no "## See also" section');
  return problems;
}

function longSentences(text: string): string[] {
  const found: string[] = [];
  for (const p of paragraphs(text)) {
    for (const s of sentences(p.text)) {
      const commas = (s.match(/,/g) ?? []).length;
      if (commas > SENTENCE_MAX_COMMAS) found.push(`${p.line}: ${commas} commas: ${s.slice(0, 80)}`);
      else if (words(s) > SENTENCE_MAX_WORDS) found.push(`${p.line}: ${words(s)} words: ${s.slice(0, 80)}`);
    }
  }
  return found;
}

function badMermaid(text: string): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*```mermaid\s*$/.test(line) && !MERMAID_TYPES.test((lines[i + 1] ?? '').trim())) found.push(`${i + 2}`);
  });
  return found;
}

describe('documentation readability (converted pages)', () => {
  it.each(CONVERTED)('%s states the present: no version history and no backlog ids', (rel) => {
    expect(versionMentions(read(rel))).toEqual([]);
  });

  it.each(CONVERTED)('%s opens with a short paragraph about the page', (rel) => {
    expect(openingProblem(read(rel))).toBeUndefined();
  });

  it.each(CONVERTED)('%s gives a long page an outline and onward links', (rel) => {
    expect(outlineProblems(read(rel))).toEqual([]);
  });

  it.each(CONVERTED)('%s puts enumerations into lists, not long sentences', (rel) => {
    expect(longSentences(read(rel))).toEqual([]);
  });

  it.each(CONVERTED)('%s uses only Mermaid diagram types that GitHub renders', (rel) => {
    expect(badMermaid(read(rel))).toEqual([]);
  });

  it('the glossary exists and the documentation index links to it', () => {
    expect(read('docs/en/README.md')).toMatch(/\]\(glossary\.md\)/);
  });
});

describe('the readability rules themselves', () => {
  it('flag version history, backlog ids, long enumerations and a missing opening', () => {
    const page = [
      '# Title',
      '',
      'Since 0.16.1, sdlc doctor --fix applies only fixes sdlc owns (B41).',
      '',
      'Worked examples: adopting, building, a newcomer, the dashboard, adopting a large codebase, tracks.',
      '',
    ].join('\n');
    expect(versionMentions(page).map((m) => m.replace(/^\d+: /, ''))).toEqual(['Since 0.16.1', '0.16.1', 'B41']);
    expect(longSentences(page)).toHaveLength(1);
    expect(openingProblem('# Title\n\n## Section\n')).toMatch(/not followed by a paragraph/);
    expect(badMermaid('```mermaid\nflowchart LR\n```\n```mermaid\nnonsense\n```\n')).toEqual(['5']);
  });

  it('negative: commands, paths and lists are not counted against a page', () => {
    const page = [
      '# Title',
      '',
      'This page explains the check.',
      '',
      '- one, two, three, four, five, six, seven',
      '',
      'Run `sdlc a, b, c, d, e, f` and keep `0.23.7`.',
      '',
    ].join('\n');
    expect(versionMentions(page)).toEqual([]);
    expect(longSentences(page)).toEqual([]);
    expect(openingProblem(page)).toBeUndefined();
  });
});
