import { listActiveChanges } from '../core/changes.js';
import { readBacklog, nextBacklogItem } from '../core/backlog.js';
import { loadConfig } from '../core/config.js';
import { evaluateChange } from '../core/lifecycle.js';
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
    const views = listActiveChanges(paths).map((ref) =>
      evaluateChange(root, ref, config, { skipFingerprint: true }));
    if (views.length) {
      const view = views.find((item) => item.next.actor === 'human') ?? views[0];
      const prefix = views.length > 1 ? `${views.length} changes · ` : '';
      const actor = view.next.actor === 'human' ? 'person' : 'agent';
      process.stdout.write(`${prefix}${view.change} · ${view.stageTitle} · next: ${actor}\n`);
      return;
    }
    const next = nextBacklogItem(readBacklog(root));
    if (next) process.stdout.write(`backlog: ${next.id} ${next.title}\n`);
  } catch {
    // Status lines fail quietly, including malformed input and project state.
  }
}
