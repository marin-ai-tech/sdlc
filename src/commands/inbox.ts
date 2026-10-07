import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { t } from '../core/i18n.js';
import { markDone, readInbox, type InboxItem } from '../mcp/inbox.js';

/** `sdlc inbox list` / `sdlc inbox done <id>`: MCP results kept for the agent (see src/mcp/inbox.ts). */
function itemLine(item: InboxItem): string {
  const state = item.ok ? c.green(t('session.inboxOk')) : c.red(t('session.inboxFailed'));
  const done = item.done ? c.dim(` ${t('inbox.read')}`) : '';
  return `${item.id}  ${item.change}  ${item.check} (${item.server}/${item.tool})  ${state}${done}`;
}

/** `sdlc inbox list [--json]`: every item, newest first. */
export async function inboxListCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const items = readInbox(loadProject().root);
    if (opts.json) return printJson({ items });
    if (items.length === 0) line(t('inbox.empty'));
    for (const item of items) line(itemLine(item));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

/** `sdlc inbox done <id> [--json]`: marks an item read; any actor may, it decides nothing. */
export async function inboxDoneCommand(id: string, opts: { json?: boolean }): Promise<void> {
  try {
    const item = markDone(loadProject().root, id);
    if (opts.json) return printJson({ item });
    line(t('inbox.marked', { id: item.id }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
