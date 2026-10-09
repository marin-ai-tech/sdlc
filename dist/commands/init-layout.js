/**
 * The AI-ready step of `sdlc init` for people: the wizard questions about git and the layout, the summary lines,
 * and the text output (the diagnosis, the documents created, the hints after a worktree build).
 * The logic lives in src/core/init-layout.ts.
 */
import { line, warn } from '../cli/output.js';
import { t } from '../core/i18n.js';
import { layoutRole } from '../core/layout.js';
function layoutChoiceList() {
    return [
        { value: 'worktree', name: t('init.layoutChoice.worktree') },
        { value: 'adapt', name: t('init.layoutChoice.adapt') },
        { value: 'none', name: t('init.layoutChoice.none') },
    ];
}
/** Canonical paths of the missing roles and `alias -> canonical` for documents under other names. */
export function diagnosisLines(diagnosis) {
    const missing = diagnosis.missing.map((role) => layoutRole(role).path);
    const aliases = diagnosis.aliases.map((alias) => `${alias.path} -> ${layoutRole(alias.role).path}`);
    if (missing.length === 0 && aliases.length === 0)
        return [];
    const lines = [t('init.diagnosis')];
    if (missing.length > 0)
        lines.push(t('init.diagnosis.missing', { list: missing.join(', ') }));
    if (aliases.length > 0)
        lines.push(t('init.diagnosis.aliases', { list: aliases.join(', ') }));
    return lines;
}
async function askEmptyFolder(prompter, folder) {
    if (folder.git)
        return { layout: 'scaffold' };
    const gitInit = await prompter.confirm(t('init.gitInit'), true);
    return gitInit ? { layout: 'scaffold', gitInit } : { layout: 'scaffold' };
}
async function askExistingFolder(prompter, folder) {
    const lines = diagnosisLines(folder.diagnosis);
    if (lines.length > 0)
        prompter.say(lines.join('\n'));
    const initial = folder.commit ? 'worktree' : 'adapt';
    const layout = await prompter.select(t('init.layoutChoice'), layoutChoiceList(), initial);
    if (layout !== 'worktree')
        return { layout };
    const answer = await prompter.input(t('init.worktreePath'), folder.worktreeDefault);
    return { layout, worktree: answer.trim() || folder.worktreeDefault };
}
/** An empty folder: git when there is none, the layout is scaffolded. An existing one: diagnosis, then the choice. */
export async function askLayoutChoices(prompter, folder) {
    if (folder.kind === 'empty')
        return askEmptyFolder(prompter, folder);
    return askExistingFolder(prompter, folder);
}
/** Summary lines for the layout answers; none when the wizard did not ask. */
export function layoutSummaryLines(choices) {
    if (!choices.layout)
        return [];
    const value = choices.worktree ? `${choices.layout} -> ${choices.worktree}` : choices.layout;
    const lines = [t('init.summary.layout', { value })];
    if (choices.gitInit)
        lines.push(t('init.summary.git', { value: t('init.yes') }));
    return lines;
}
/** The init options matching the layout answers. */
export function layoutOptions(choices) {
    return {
        ...(choices.layout ? { layout: choices.layout } : {}),
        ...(choices.worktree ? { worktree: choices.worktree } : {}),
        ...(choices.gitInit ? { gitInit: true } : {}),
    };
}
/** Printed before the init output of the worktree, which then names the adopt workflow of each tool. */
function printWorktreeHints(layout, notes) {
    const worktree = layout.worktree;
    if (!worktree)
        return;
    line();
    line(t('init.worktree.built', { path: worktree.path }));
    line(t('init.worktree.branch', { branch: worktree.branch, commit: worktree.commit }));
    const moved = (notes?.moves ?? []).map((move) => `${move.from} -> ${move.to}`);
    if (moved.length > 0)
        line(t('init.worktree.moved', { list: moved.join(', ') }));
    if (notes?.uncommitted)
        warn(t('init.worktree.uncommitted'));
    line(t('init.worktree.open', { path: worktree.path }));
    line(t('init.worktree.merge', { branch: worktree.branch }));
    line(t('layout.discard', { path: worktree.path, branch: worktree.branch }));
}
/** Text output of the layout step, after the usual init output. */
export function printLayoutText(done) {
    const layout = done.layout;
    if (layout.action === 'worktree')
        return printWorktreeHints(layout, done.notes);
    if (layout.created) {
        const list = layout.created.join(', ') || t('init.none');
        line(t('init.layoutCreated', { action: layout.action, list }));
        return;
    }
    const lines = layout.diagnosis ? diagnosisLines(layout.diagnosis) : [];
    if (lines.length === 0)
        return;
    line();
    for (const text of lines)
        line(text);
    line(t('init.diagnosis.suggest'));
}
