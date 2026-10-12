import * as path from 'node:path';
import { readText } from './fs-utils.js';
import { t } from './i18n.js';
import type { LifecycleView, NextAction } from './lifecycle.js';

const REQUIRED = [
  'Problem',
  'Proposed outcome',
  'Affected users and systems',
  'Constraints',
  'Success measures',
  'Out of scope',
];

function emptySection(text: string, heading: string): boolean {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return false;
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  return body.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

/** A backlog intent has a real file, but its empty required sections still need the agent. */
export function draftIntentNext(view: LifecycleView, next: NextAction): NextAction {
  if (next.action !== 'approve-gate' || next.gate !== 'intent') return next;
  const text = readText(path.join(view.dir, 'intent.md'));
  if (text === undefined || !REQUIRED.some((heading) => emptySection(text, heading))) return next;
  const params = { artifact: 'intent', file: 'intent.md', gate: 'intent' };
  return {
    actor: 'agent',
    action: 'write-artifact',
    workflow: 'intent',
    artifact: 'intent',
    cli: `sdlc instructions intent --change ${view.change} --json`,
    key: 'next.writeArtifact',
    params,
    message: t('next.writeArtifact', params, 'en'),
  };
}
