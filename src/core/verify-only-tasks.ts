import * as path from 'node:path';
import { readText } from './fs-utils.js';
import { t } from './i18n.js';
import { parseTasks } from './tasks.js';
import type { ValidationIssue } from './validate-change.js';

const AUTOMATED = [
  /\b(?:npm\s+(?:test|run\s+test\S*)|(?:npx\s+)?vitest\b|node\s+--test\b|(?:pnpm|yarn)\s+(?:run\s+)?test\b)/i,
  /\b(?:(?:npx\s+)?playwright\s+test|pytest|jest|cargo\s+test|go\s+test)\b/i,
  /\b\S+\.(?:test|spec)\.[cm]?[jt]sx?\b/i,
];
const MANUAL = [
  /\bmanually\s+(?:check|verify|test|inspect|review)\b/i,
  /\b(?:check|verify|test|inspect|review)\b[^.;]*\bmanually\b/i,
  /\bmanual\s+(?:check|test|review|inspection|testing|QA)\b/i,
];
const BROWSER = [
  /\b(?:check|verify|test|open|inspect|review|confirm|try|run)\b[^.;]*\bbrowsers?\b/i,
  /\bbrowser\s+check\b/i,
];
const DEVICE = [
  /\b(?:check|verify|test|run|try|inspect)\b[^.;]*\bon\s+(?:a\s+)?(?:real\s+)?device\b/i,
  /\bdevice\s+check\b|\b(?:verify|test|check)\s+on\s+(?:a\s+)?(?:phone|tablet)\b/i,
];
const SCREENSHOT = [
  /\b(?:take|capture|make|collect)\b[^.;]*\bscreenshots?\b/i,
  /\brecord\b[^.;]*\bscreenshots?\b(?!\s+(?:id|upload))/i,
  /\bscreenshots?\s+(?:of|the)\b/i,
];
const VERIFY = /`[^`]*\bsdlc\s+verify\b[^`]*`|\b(?:run|perform|do|execute)\s+(?:npx\s+)?(?:the\s+)?sdlc\s+verify\b/i;

/** Warn about open work that can only be completed while verifying the change. */
export function verifyOnlyTasks(changeDir: string): ValidationIssue[] {
  const content = readText(path.join(changeDir, 'tasks.md'));
  if (content === undefined) return [];
  return parseTasks(content).tasks.flatMap((task) => {
    const text = task.description.slice(0, 4000);
    if (task.done) return [];
    if (!VERIFY.test(text) && AUTOMATED.some((pattern) => pattern.test(text))) return [];
    const action = text.replace(/^\d+(?:\.\d+)*\s*/, '');
    if (/^(?:run|build|compile)\s+(?:the\s+)?(?:browser|device|screenshot)\b[^.;]*\b(?:build|bundle)\b/i
      .test(action)) return [];
    if (![...MANUAL, ...BROWSER, ...DEVICE, ...SCREENSHOT, VERIFY]
      .some((pattern) => pattern.test(text))) return [];
    const number = /^\d+(?:\.\d+)*/.exec(text)?.[0] ?? String(task.line);
    const textKey = 'validate.verifyOnlyTask';
    const textParams = { number };
    return [{
      source: 'sdlc' as const, level: 'warning' as const, path: 'tasks.md', line: task.line,
      message: t(textKey, textParams, 'en'), textKey, textParams,
    }];
  });
}
