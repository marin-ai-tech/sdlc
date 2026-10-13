import { loadProject } from '../cli/context.js';
import { printJson, reportFailure, line } from '../cli/output.js';
import { addBacklogItem, readBacklog } from '../core/backlog.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';

/**
 * `sdlc triage intake` (B99): one alert JSON on stdin becomes a backlog item with
 * `Source: alert:<id>`. Same alert again returns `{ duplicate: true }` (no throw to the user).
 * Anyone may run it; it never sets priority.
 */

const ALERT_ID_MAX = 128;
const ALERT_TITLE_MAX = 200;

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

function invalidAlert(): SdlcError {
  return new SdlcError(
    'invalid_alert',
    { key: 'error.invalid_alert' },
    { key: 'error.invalid_alert.fix' },
  );
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface AlertInput {
  id: string;
  title: string;
}

/** Parses one alert; refuses non-JSON, missing id/title, or oversized fields. */
export function parseAlert(raw: string): AlertInput {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw invalidAlert();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidAlert();
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim() === '') throw invalidAlert();
  if (typeof obj.title !== 'string' || obj.title.trim() === '') throw invalidAlert();
  const id = obj.id.trim();
  const title = stripControls(obj.title);
  if (!title || id.length > ALERT_ID_MAX || title.length > ALERT_TITLE_MAX) throw invalidAlert();
  if (/[\u0000-\u001f\u007f]/.test(id)) throw invalidAlert();
  return { id, title };
}

function existingBySource(root: string, source: string) {
  return readBacklog(root).items.find((item) =>
    item.source === source && item.status !== 'done' && item.status !== 'dropped');
}

/** `sdlc triage intake [--json]`: stdin alert JSON → backlog item or duplicate. */
export async function triageIntakeCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const alert = parseAlert(await readStdin());
    const ctx = loadProject();
    const source = `alert:${alert.id}`;
    try {
      const item = addBacklogItem(ctx.root, { title: alert.title, source });
      if (opts.json) return printJson({ duplicate: false, item });
      line(t('triage.intake.added', { id: item.id, source }));
    } catch (error) {
      if (!(error instanceof SdlcError) || error.code !== 'duplicate_item') throw error;
      const item = existingBySource(ctx.root, source);
      if (!item) throw error;
      if (opts.json) return printJson({ duplicate: true, item });
      line(t('triage.intake.duplicate', { id: item.id, source }));
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
