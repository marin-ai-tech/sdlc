import { listActiveChanges } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { readBacklog, nextBacklogItem } from '../core/backlog.js';
import { loadConfig } from '../core/config.js';
import { evaluateChange, sharedFingerprint } from '../core/lifecycle.js';
import { findProjectRoot, projectPaths } from '../core/project.js';

async function input(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

export async function statuslineCommand(): Promise<void> {
  try {
    const data = JSON.parse(await input()) as { cwd?: string; workspace?: { current_dir?: string } };
    const cwd = data.cwd ?? data.workspace?.current_dir;
    if (typeof cwd !== 'string') return;
    const root = findProjectRoot(cwd);
    if (!root) return;
    const paths = projectPaths(root);
    const config = loadConfig(paths.sdlcConfig);
    const refs = listActiveChanges(paths);
    // One worktree fingerprint for all changes, so the line is as fresh as `sdlc status` (B88); none without changes.
    const fingerprint = refs.length ? sharedFingerprint(root) : null;
    const views = refs.map((ref) => evaluateChange(root, ref, config, { fingerprint }));
    if (views.length) {
      const view = views.find((item) => item.next.actor === 'human') ?? views[0];
      const prefix = views.length > 1 ? t('statusline.changesPrefix', { count: views.length }) : '';
      const actor = t(view.next.actor === 'human' ? 'statusline.actor.person' : 'statusline.actor.agent');
      const stage = t(`stage.${view.stage}`);
      process.stdout.write(t('statusline.line', { prefix, change: view.change, stage, actor }) + '\n');
      return;
    }
    const next = nextBacklogItem(readBacklog(root));
    if (next) process.stdout.write(t('statusline.backlog', { id: next.id, title: next.title }) + '\n');
  } catch {
    // Status lines fail quietly, including malformed input and project state.
  }
}
