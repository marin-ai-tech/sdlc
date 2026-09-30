import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { addDeferred, closeDeferred, readDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { appendLog } from '../core/log.js';

function formatDeferredTable(items: Array<{ id: string; status: string; title: string; change?: string }>): string {
  const headers = ['ID', 'Status', 'Title', 'Change'];
  const rows = items.map((item) => {
    const change = item.change ?? '-';
    return [item.id, item.status, item.title, change];
  });
  const widths = headers.map((header, index) => {
    let width = header.length;
    for (const row of rows) {
      const cellWidth = row[index].length;
      if (cellWidth > width) {
        width = cellWidth;
      }
    }
    return width;
  });
  const lines = [headers, ...rows].map((cells) => {
    const padded = cells.map((cell, index) => cell.padEnd(widths[index]));
    return padded.join('  ').trimEnd();
  });
  return lines.join('\n');
}

export function deferAdd(title: string, opts: { why?: string; change?: string; finding?: string; revisit?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    if (!opts.why) throw new SdlcError('invalid_option', '--why is required.');
    const by = formatIdentity(gitIdentity(ctx.root));
    const item = addDeferred(ctx.root, { title, why: opts.why, change: opts.change, finding: opts.finding, revisit: opts.revisit, by });
    appendLog(ctx.root, ctx.config, { event: 'deferred.added', change: item.change, by, detail: `${item.id} ${item.title}` }, ctx.stamp);
    if (opts.json) printJson({ item, harness: ctx.stamp });
    else line(`${item.id} ${item.title}`);
  } catch (error) { reportFailure(error, opts.json); }
}

export function deferList(opts: { open?: boolean; change?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const items = readDeferred(ctx.root).filter((item) => (!opts.open || item.status === 'open') && (!opts.change || item.change === opts.change));
    if (opts.json) {
      printJson({ items, harness: ctx.stamp });
      return;
    }
    if (items.length === 0) {
      line('No deferred work.');
      return;
    }
    line(formatDeferredTable(items));
  } catch (error) { reportFailure(error, opts.json); }
}

export function deferClose(id: string, opts: { status?: string; note?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    if (opts.status !== 'done' && opts.status !== 'dropped') throw new SdlcError('invalid_option', '--status must be done or dropped.');
    if (!opts.note) throw new SdlcError('invalid_option', '--note is required.');
    const item = closeDeferred(ctx.root, id, opts.status, opts.note);
    appendLog(ctx.root, ctx.config, { event: 'deferred.closed', change: item.change, detail: `${item.id} ${item.title}` }, ctx.stamp);
    if (opts.json) printJson({ item, harness: ctx.stamp });
    else line(`${item.id} ${item.status} ${item.title}`);
  } catch (error) { reportFailure(error, opts.json); }
}
