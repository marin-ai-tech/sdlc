import { assertCliValue } from './cli-value.js';
import type { QuestionArtifact } from './answer-record.js';
import { createHash } from 'node:crypto';

export type DraftShell = 'posix' | 'powershell';

interface ShellChoice {
  shell?: DraftShell;
}

export interface DraftFile {
  path: string;
  content: string;
}

function draftFile(kind: string, identity: readonly string[], content: string): DraftFile {
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { path: `sdlc-draft-${kind}-${digest}.txt`, content };
}

export interface CommitDraftInput extends ShellChoice {
  change: string;
  task: string;
  message: string;
  paths: readonly string[];
}

export interface AnswerDraftInput extends ShellChoice {
  cli: string;
  change: string;
  question: string | number;
  artifact?: QuestionArtifact;
  answer: string;
}

/** Literal shell words, never evaluated. Callers display the result for the person to edit and run. */
export function quoteDraftArgument(value: string, shell: DraftShell): string {
  const escaped = shell === 'powershell' ? value.replace(/'/g, "''") : value.replace(/'/g, "'\"'\"'");
  return `'${escaped}'`;
}

function draftShell(input: ShellChoice): DraftShell {
  return input.shell ?? (process.platform === 'win32' ? 'powershell' : 'posix');
}

export function commitDraft(input: CommitDraftInput): { commands: string[]; message: string; files: DraftFile[] } {
  const quote = (value: string) => quoteDraftArgument(value, draftShell(input));
  const message = [input.message.trimEnd(), '', `SDLC-Change: ${input.change}`, `SDLC-Task: ${input.task}`].join('\n');
  const file = draftFile('commit', [input.change, input.task], message);
  const commands = [
    `git add -- ${input.paths.map(quote).join(' ')}`,
    `git commit -F ${quote(file.path)}`,
  ];
  return { commands, message, files: [file] };
}

export function answerDraft(input: AnswerDraftInput): { command: string; answer: string; files: DraftFile[] } {
  assertCliValue(input.cli, 'cli');
  const args = ['answer', String(input.question), '--change', input.change];
  if (input.artifact) args.push('--artifact', input.artifact);
  const file = draftFile('answer', [input.change, input.artifact ?? 'intent', String(input.question)], input.answer);
  const files = draftShell(input) === 'powershell' ? [file] : [];
  args.push(...(files.length ? ['--text-file', file.path] : ['--text', input.answer]));
  const words = args.map((word) => quoteDraftArgument(word, draftShell(input)));
  return { command: `${input.cli} ${words.join(' ')}`, answer: input.answer, files };
}
