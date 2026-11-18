import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { readLog } from '../core/log.js';
import { buildTimeline, type Timeline, type TimelineSpan } from '../core/timeline.js';

interface Options { json?: boolean }

/** Minutes below an hour, hours with one decimal above. */
function length(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 60) return t('timeline.duration', { minutes: minutes.toFixed(1) });
  return t('timeline.hours', { hours: (minutes / 60).toFixed(1) });
}

function duration(span: TimelineSpan): string {
  if (!span.end) return t('timeline.open');
  return length(Date.parse(span.end) - Date.parse(span.start));
}

function shortFingerprint(value: unknown): string {
  return String(value).replace(/^git-tree:/, '').slice(0, 12);
}

function details(span: TimelineSpan): string {
  if (span.kind === 'run') return [shortFingerprint(span.attrs.fingerprint), span.attrs.trigger]
    .filter((value) => value !== null).join(' ');
  if (span.kind === 'wait') return t('timeline.approvals', { count: String(span.attrs.approvals) });
  if (span.kind === 'round') return t('timeline.round', { n: String(span.attrs.n) });
  return '';
}

function printText(timeline: Timeline): void {
  line(t(timeline.archived ? 'timeline.headingArchived' : 'timeline.heading', { change: timeline.change }));
  for (const span of timeline.spans) {
    const fields = [span.start, span.end ?? t('timeline.open'), duration(span),
      span.kind, span.name, details(span)].filter(Boolean);
    line(fields.join('  '));
  }
  if (timeline.spans.length === 0) line(t('timeline.noData'));
  const summary = t('timeline.summary', {
    wall: length(timeline.summary.wallMs),
    run: length(timeline.summary.covered.run),
    wait: length(timeline.summary.covered.wait),
  });
  const absent = (['wait', 'run', 'round'] as const)
    .filter((kind) => !timeline.spans.some((span) => span.kind === kind));
  const note = absent.length > 0 ? ` ${t('timeline.unrecorded', { kinds: absent.join(', ') })}` : '';
  line(`${summary}${note}`);
}

export function timelineCommand(id: string, opts: Options): void {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, id, { allowArchived: true });
    const state = readChangeState(ref.dir);
    const log = readLog(ctx.root).filter((entry) => entry.change === ref.id);
    const timeline = buildTimeline(ref.id, ref.archived, state, log);
    if (opts.json) printJson({ ...timeline, harness: ctx.stamp });
    else printText(timeline);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
