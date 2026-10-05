/**
 * The AI-ready step of `sdlc init` for people: the wizard questions about git and the layout, the summary lines,
 * and the text output (the diagnosis, the documents created, the hints after a worktree build).
 * The logic lives in src/core/init-layout.ts.
 */
import { line, warn } from '../cli/output.js';
import type { SdlcConfig } from '../core/config.js';
import { t } from '../core/i18n.js';
import type {
  FolderDescription,
  LayoutAction,
  LayoutDiagnosis,
  LayoutInit,
  LayoutOptions,
  LayoutOutcome,
  WorktreeNotes,
} from '../core/init-layout.js';
import { layoutRole } from '../core/layout.js';
import type { Prompter } from './init-wizard.js';

/** The wizard's answers about the layout; absent fields were not asked. */
export interface LayoutChoices {
  layout: LayoutAction;
  worktree?: string;
  gitInit?: boolean;
}

function layoutChoiceList(): Array<{ value: LayoutAction; name: string }> {
  return [
    { value: 'worktree', name: t('init.layoutChoice.worktree') },
    { value: 'adapt', name: t('init.layoutChoice.adapt') },
    { value: 'none', name: t('init.layoutChoice.none') },
  ];
}

/** Canonical paths of the missing roles and `alias -> canonical` for documents under other names. */
export function diagnosisLines(diagnosis: LayoutDiagnosis): string[] {
  const missing = diagnosis.missing.map((role) => layoutRole(role).path);
  const aliases = diagnosis.aliases.map((alias) => `${alias.path} -> ${layoutRole(alias.role).path}`);
  if (missing.length === 0 && aliases.length === 0) return [];
  const lines = [t('init.diagnosis')];
  if (missing.length > 0) lines.push(t('init.diagnosis.missing', { list: missing.join(', ') }));
  if (aliases.length > 0) lines.push(t('init.diagnosis.aliases', { list: aliases.join(', ') }));
  return lines;
}

async function askEmptyFolder(prompter: Prompter, folder: FolderDescription): Promise<LayoutChoices> {
  if (folder.git) return { layout: 'scaffold' };
  const gitInit = await prompter.confirm(t('init.gitInit'), true);
  return gitInit ? { layout: 'scaffold', gitInit } : { layout: 'scaffold' };
}

async function askExistingFolder(prompter: Prompter, folder: FolderDescription): Promise<LayoutChoices> {
  const lines = diagnosisLines(folder.diagnosis);
  if (lines.length > 0) prompter.say(lines.join('\n'));
  const initial: LayoutAction = folder.commit ? 'worktree' : 'adapt';
  const layout = await prompter.select(t('init.layoutChoice'), layoutChoiceList(), initial);
  if (layout !== 'worktree') return { layout };
  const answer = await prompter.input(t('init.worktreePath'), folder.worktreeDefault);
  return { layout, worktree: answer.trim() || folder.worktreeDefault };
}

/** An empty folder: git when there is none, the layout is scaffolded. An existing one: diagnosis, then the choice. */
export async function askLayoutChoices(prompter: Prompter, folder: FolderDescription): Promise<LayoutChoices> {
  if (folder.kind === 'empty') return askEmptyFolder(prompter, folder);
  return askExistingFolder(prompter, folder);
}

/** Summary lines for the layout answers; none when the wizard did not ask. */
export function layoutSummaryLines(choices: Partial<LayoutChoices>): string[] {
  if (!choices.layout) return [];
  const value = choices.worktree ? `${choices.layout} -> ${choices.worktree}` : choices.layout;
  const lines = [t('init.summary.layout', { value })];
  if (choices.gitInit) lines.push(t('init.summary.git', { value: t('init.yes') }));
  return lines;
}

/** The init options matching the layout answers. */
export function layoutOptions(choices: Partial<LayoutChoices>): LayoutOptions {
  return {
    ...(choices.layout ? { layout: choices.layout } : {}),
    ...(choices.worktree ? { worktree: choices.worktree } : {}),
    ...(choices.gitInit ? { gitInit: true } : {}),
  };
}

/** After the usual init output, which already names the adopt workflow of each tool. */
function printWorktreeHints(layout: LayoutOutcome, notes: WorktreeNotes | undefined): void {
  const worktree = layout.worktree;
  if (!worktree) return;
  line();
  line(t('init.worktree.built', { path: worktree.path }));
  line(t('init.worktree.branch', { branch: worktree.branch, commit: worktree.commit }));
  const moved = (notes?.moves ?? []).map((move) => `${move.from} -> ${move.to}`);
  if (moved.length > 0) line(t('init.worktree.moved', { list: moved.join(', ') }));
  if (notes?.uncommitted) warn(t('init.worktree.uncommitted'));
  line(t('init.worktree.open', { path: worktree.path }));
  line(t('init.worktree.merge', { branch: worktree.branch }));
  line(t('layout.discard', { path: worktree.path, branch: worktree.branch }));
}

/** Text output of the layout step, after the usual init output. */
export function printLayoutText<T extends { config: SdlcConfig }>(done: LayoutInit<T>): void {
  const layout = done.layout;
  if (layout.action === 'worktree') return printWorktreeHints(layout, done.notes);
  if (layout.created) {
    const list = layout.created.join(', ') || t('init.none');
    line(t('init.layoutCreated', { action: layout.action, list }));
    return;
  }
  const lines = layout.diagnosis ? diagnosisLines(layout.diagnosis) : [];
  if (lines.length === 0) return;
  line();
  for (const text of lines) line(text);
  line(t('init.diagnosis.suggest'));
}
