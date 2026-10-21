import { describe, expect, it } from 'vitest';
import { humanEnv, runCli, tempDir } from './helpers.js';

/**
 * The owner's remark (2026-10-15): `sdlc guide lifecycle` printed the article as Markdown, which a terminal does not
 * render. A person's terminal now gets plain text: headings without `#` (underlined), tables as aligned columns
 * without pipes, code blocks without fences (indented), inline code and emphasis without their marks. An agent
 * session keeps the Markdown (the agent reads it), `--markdown` forces it, and `--json` is unchanged.
 */

const AGENT = { CLAUDECODE: '1' };

function cli(args: string[], extra: NodeJS.ProcessEnv = {}) {
  const env = humanEnv(tempDir('sdlc-home-'), extra);
  return runCli(args, tempDir('sdlc-guide-term-'), env);
}

/** What a Markdown source shows that a terminal cannot render. */
function markdownMarks(text: string): string[] {
  const marks: string[] = [];
  if (/^```/m.test(text)) marks.push('code fence');
  if (/^\s*\|.*\|\s*$/m.test(text)) marks.push('table row with pipes');
  if (/^\s*\|?\s*-{3,}\s*\|/m.test(text)) marks.push('table separator');
  if (/^#{1,6} /m.test(text)) marks.push('heading mark');
  if (/`[^`\n]+`/.test(text)) marks.push('inline code backticks');
  if (/\*\*[^*\n]+\*\*/.test(text)) marks.push('bold marks');
  return marks;
}

describe('sdlc guide in a terminal', () => {
  it('a person gets plain text: no Markdown marks, the content kept', () => {
    const r = cli(['guide', 'lifecycle']);
    expect(r.code, r.stderr).toBe(0);
    expect(markdownMarks(r.stdout)).toEqual([]);
    expect(r.stdout).toContain('Lifecycle and stages');
    expect(r.stdout).toMatch(/explore → intent → spec → plan/);
    expect(r.stdout).toMatch(/plan\s+intent\.md: problem, outcome, success measures\s+intent \(product owner\)/);
    expect(r.stdout).toMatch(/^Lifecycle and stages\n[=─━]+$/m);
  }, 120000);


  it('an agent session keeps the Markdown; --markdown forces it; --json is unchanged', () => {
    const agent = cli(['guide', 'lifecycle'], AGENT);
    expect(agent.stdout).toMatch(/^# Lifecycle and stages$/m);
    expect(agent.stdout).toMatch(/^\| Stage \|/m);
    expect(agent.stdout).toMatch(/^```$/m);
    const forced = cli(['guide', 'lifecycle', '--markdown']);
    expect(forced.stdout).toMatch(/^\| Stage \|/m);
    const json = cli(['guide', 'lifecycle', '--json']).json<{ body: string }>();
    expect(json.body).toMatch(/^\| Stage \|/m);
    expect(json.body).toMatch(/^```$/m);
  }, 120000);
  it('the English, and for a section and a tour step', () => {
    const section = cli(['guide', 'denials#plan-gate']);
    expect(section.code, section.stderr).toBe(0);
    expect(markdownMarks(section.stdout)).toEqual([]);
    const tour = cli(['guide', 'tour', '1']);
    expect(tour.code, tour.stderr).toBe(0);
    expect(markdownMarks(tour.stdout)).toEqual([]);
  }, 120000);
});
