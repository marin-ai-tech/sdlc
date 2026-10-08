import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
import { stripProvenance } from './license.js';

/**
 * The debate lens (0.12.0, B20): `design: { debate: <bool>, debate_sides: [<a>, <b>] }` in openspec/sdlc.yaml, off by
 * default. When on, two `sdlc-advocate` subagents with opposite priorities argue the key design decision, and
 * design.md records it under `## Debate` with two `### Position: …` subsections and a non-empty `### Decision`. The
 * spec gate is approved only once that section is there.
 */
export interface DesignConfig {
  debate: boolean;
  sides: [string, string];
}

export const DEFAULT_SIDES: [string, string] = ['simplicity and speed', 'robustness and safety'];
const KEYS = ['debate', 'debate_sides'];

function invalid(key: string, where: string): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where } });
}

function parseSides(value: unknown, where: string): [string, string] {
  if (value === undefined || value === null) return [...DEFAULT_SIDES];
  const text = (side: unknown) => typeof side === 'string' && side.trim() !== '';
  const ok = Array.isArray(value) && value.length === 2 && value.every(text);
  if (!ok) throw invalid('error.debate_sides', where);
  return [String(value[0]).trim(), String(value[1]).trim()];
}

/** `design`: absent = undefined (the lens is off). */
export function parseDesignConfig(value: unknown, where: (key: string) => string): DesignConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where('design'));
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).find((key) => !KEYS.includes(key));
  if (unknown !== undefined) throw invalid('error.design_unknown_key', where(`design.${unknown}`));
  if (raw.debate !== undefined && typeof raw.debate !== 'boolean') {
    throw invalid('error.x_must_be_true_or_false', where('design.debate'));
  }
  return { debate: raw.debate === true, sides: parseSides(raw.debate_sides, where('design.debate_sides')) };
}

export function debateOn(config: Pick<SdlcConfig, 'design'>): boolean {
  return config.design?.debate === true;
}

/** The lines outside fenced code blocks: a `# comment` in a code sample is not a heading. */
function proseLines(text: string): string[] {
  let fence = false;
  return text.split(/\r?\n/).filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fence = !fence;
      return false;
    }
    return !fence;
  });
}

/** The lines of `## Debate` up to the next `## ` heading; undefined without it. */
function debateSection(text: string): string[] | undefined {
  const lines = proseLines(text);
  const start = lines.findIndex((line) => /^##\s+debate\s*$/i.test(line.trim()));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Text under the `### Decision` heading of the section, trimmed. */
function decisionText(section: string[]): string {
  const start = section.findIndex((line) => /^###\s+decision\s*:?\s*$/i.test(line.trim()));
  if (start < 0) return '';
  const rest = section.slice(start + 1);
  const end = rest.findIndex((line) => /^###\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** True when design.md records both positions and the decision. */
export function debateRecorded(changeDir: string): boolean {
  const text = stripProvenance(readText(path.join(changeDir, 'design.md')) ?? '');
  const section = debateSection(text);
  if (!section) return false;
  const positions = section.filter((line) => /^###\s+position\b/i.test(line.trim())).length;
  return positions >= 2 && decisionText(section) !== '';
}

/** Refuses the spec approval while the lens is on and design.md has no complete debate (`debate_required`). */
export function assertDebateRecorded(config: Pick<SdlcConfig, 'design'>, changeDir: string, gate: string): void {
  if (gate !== 'spec' || !debateOn(config) || debateRecorded(changeDir)) return;
  throw new SdlcError(
    'debate_required',
    { key: 'error.debate_required' },
    { key: 'fix.debate_required', params: { sides: (config.design?.sides ?? DEFAULT_SIDES).join(' / ') } },
  );
}
