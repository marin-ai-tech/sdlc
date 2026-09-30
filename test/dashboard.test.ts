import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { STAGE_TITLES, STAGES } from '../src/core/lifecycle.js';
import { reportProject, XSS_NOTE, XSS_REF, type ReportProject } from './report-fixture.js';

describe('sdlc dashboard (static HTML)', () => {
  let p: ReportProject;
  let html: string;
  beforeAll(() => {
    p = reportProject();
    const r = p.cli(['dashboard']);
    if (r.code !== 0) throw new Error(r.stderr);
    html = r.stdout;
  });

  it('is one HTML document with every change, every stage and the layout readiness', () => {
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('say-hello');
    expect(html).toContain('add-farewell');
    for (const s of STAGES) expect(html, s).toContain(STAGE_TITLES[s]);
    expect(html).toMatch(/readiness|layout/i);
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('negative: loads nothing from the network', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*\shref=/i);
    expect(html).not.toMatch(/<img[^>]*\ssrc=["']?https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/i);
  });

  it('negative: escapes text that came from people and agents', () => {
    expect(html).not.toContain(XSS_NOTE);
    expect(html).not.toContain(XSS_REF);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('--out writes the file; report --format html renders the same dashboard', () => {
    const out = p.cli(['dashboard', '--out', 'reports/dashboard.html']);
    expect(out.code, out.stderr).toBe(0);
    const file = fs.readFileSync(path.join(p.root, 'reports/dashboard.html'), 'utf-8');
    expect(file).toContain('add-farewell');
    const viaReport = p.cli(['report', '--format', 'html']);
    expect(viaReport.code, viaReport.stderr).toBe(0);
    expect(viaReport.stdout.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(viaReport.stdout).toContain('say-hello');
  });
});
