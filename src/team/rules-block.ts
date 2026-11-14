import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import type { RuleEntry } from './record.js';
import { RULES_END, RULES_START } from './rules.js';

/**
 * The team rules block of AGENTS.md (0.32.0): sdlc owns only the text between `<!-- sdlc:rules:start -->` and
 * `<!-- sdlc:rules:end -->`, written from the accepted rules without `paths`; the person's text around it is never
 * changed. Missing markers are appended at the end of the file.
 */
export type BlockState = 'ok' | 'edited' | 'missing';

export function agentsGuidePath(config: SdlcConfig): string {
  return config.layout?.['agents-guide'] ?? 'AGENTS.md';
}

/** The general rules, sorted by id. */
export function generalRules(rules: Record<string, RuleEntry>): Array<[string, RuleEntry]> {
  return Object.entries(rules).filter(([, rule]) => !rule.paths || rule.paths.length === 0).sort(([a], [b]) =>
    a.localeCompare(b));
}

/** A rule's own first heading becomes its section title (`### <title> (<id>)`), so headings do not nest oddly. */
export function ruleTitle(text: string, id: string): { title: string; body: string } {
  const trimmed = text.trim();
  const heading = /^#{1,6}[ \t]+(.+)\n?/.exec(trimmed);
  if (!heading) return { title: id, body: trimmed };
  return { title: `${heading[1].trim()} (${id})`, body: trimmed.slice(heading[0].length).trim() };
}

export function renderRulesBlock(rules: Record<string, RuleEntry>): string {
  const lines = [RULES_START, '## Team rules', ''];
  const general = generalRules(rules);
  if (general.length === 0) lines.push('No team rules are accepted yet (`sdlc team sync`, then a person runs');
  if (general.length === 0) lines.push('`sdlc team accept --rule <id>`).', '');
  for (const [id, rule] of general) {
    const { title, body } = ruleTitle(rule.text, id);
    lines.push(`### ${title}`, '', body, '');
  }
  lines.push(RULES_END);
  return lines.join('\n');
}

interface Located {
  text: string;
  start: number;
  end: number;
}

function locate(text: string): Located | undefined {
  const start = text.indexOf(RULES_START);
  const endMarker = text.indexOf(RULES_END, start + RULES_START.length);
  if (start < 0 || endMarker < 0) return undefined;
  return { text, start, end: endMarker + RULES_END.length };
}

/** The file with the block replaced, or appended when the markers are missing. */
function withBlock(text: string, block: string): string {
  const found = locate(text);
  if (found) return `${text.slice(0, found.start)}${block}${text.slice(found.end)}`;
  const separator = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${separator}${block}\n`;
}

/**
 * Writes the block from the accepted rules; true when the file changed. The file's own line endings are kept and a
 * block that differs only in them is left alone (a Windows checkout turns LF into CRLF).
 */
export function applyRulesBlock(root: string, config: SdlcConfig, rules: Record<string, RuleEntry>): boolean {
  const file = path.join(root, agentsGuidePath(config));
  const raw = readText(file);
  // Without general rules and without the markers, a person's file is left exactly as it is.
  if (generalRules(rules).length === 0 && (raw === undefined || !locate(raw))) return false;
  const crlf = raw !== undefined && raw.includes('\r\n');
  const current = raw?.replace(/\r\n/g, '\n');
  const lf = withBlock(current ?? '', renderRulesBlock(rules));
  if (lf === current) return false;
  const next = crlf ? lf.replace(/\n/g, '\r\n') : lf;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeTextAtomic(file, next);
  return true;
}

/** For doctor: whether the block still says what the accepted rules say. */
export function rulesBlockState(root: string, config: SdlcConfig, rules: Record<string, RuleEntry>): BlockState {
  const text = readText(path.join(root, agentsGuidePath(config)))?.replace(/\r\n/g, '\n');
  const found = text === undefined ? undefined : locate(text);
  if (!found) return 'missing';
  return found.text.slice(found.start, found.end) === renderRulesBlock(rules) ? 'ok' : 'edited';
}
