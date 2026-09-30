import type { ReportChange, ReportModel } from './model.js';
import { PROJECT_URL } from '../core/license.js';
import {
  isStepDone,
  progressSteps,
  sanitizeMermaidLabel,
  type ProgressView,
} from '../cli/progress.js';

function cell(value: unknown): string {
  return String(value ?? '-')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function stages(model: ReportModel): string[] {
  return [
    '## Stages', '',
    '| Stage | Active |',
    '| --- | ---: |',
    ...model.summary.byStage.map((stage) => `| ${cell(stage.title)} | ${stage.count} |`),
    '',
  ];
}

function changes(model: ReportModel): string[] {
  return [
    '## Changes', '',
    '| Change | Stage | Tasks | Verification | Next |',
    '| --- | --- | --- | --- | --- |',
    ...model.changes.map((change) =>
      `| ${cell(change.id)} | ${cell(change.stageTitle)} | ${change.tasks.complete}/${change.tasks.total} | ${cell(change.verification)} | ${cell(change.next.message)} |`),
    '',
  ];
}

function asProgressView(change: ReportChange): ProgressView {
  return {
    gates: change.gates,
    tasks: change.tasks,
    archived: change.archived,
  };
}

function nodeId(prefix: string, step: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_]/g, '_');
  return `${safe}_${step}`;
}

function changeFlowchart(change: ReportChange): string[] {
  const view = asProgressView(change);
  const steps = progressSteps(view);
  const label = sanitizeMermaidLabel(change.id);
  const lines = ['```mermaid', 'flowchart LR', `  subgraph ${nodeId('chg', change.id)}["${label}"]`];
  lines.push('    direction LR');
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const id = nodeId(change.id, step);
    lines.push(`    ${id}["${sanitizeMermaidLabel(step)}"]`);
    if (i > 0) {
      const prev = nodeId(change.id, steps[i - 1]!);
      lines.push(`    ${prev} --> ${id}`);
    }
  }
  const current = steps.find((step) => !isStepDone(step, view));
  lines.push('  end');
  lines.push('  classDef current fill:#fef3c7,stroke:#d97706,color:#000');
  if (current) {
    lines.push(`  class ${nodeId(change.id, current)} current`);
  }
  lines.push('```', '');
  return lines;
}

function epicFlowchart(model: ReportModel): string[] {
  const epics = model.backlog.epics;
  if (!epics.length) return [];
  const lines = ['```mermaid', 'flowchart LR'];
  for (const epic of epics) {
    const total = epic.open + epic.inProgress + epic.done;
    const id = nodeId('epic', epic.id);
    const title = sanitizeMermaidLabel(`${epic.id} ${epic.title}`);
    const progress = sanitizeMermaidLabel(`${epic.done}/${total}`);
    lines.push(`  ${id}["${title}"] --> ${id}_p["${progress}"]`);
  }
  lines.push('```', '');
  return lines;
}

function mermaidDiagrams(model: ReportModel): string[] {
  const active = model.changes.filter((change) => !change.archived);
  const lines: string[] = [];
  if (active.length) {
    lines.push('## Lifecycle diagrams', '');
    for (const change of active) {
      lines.push(...changeFlowchart(change));
    }
  }
  if (model.backlog.epics.length) {
    lines.push('## Epic progress', '');
    lines.push(...epicFlowchart(model));
  }
  return lines;
}

function leadTimes(model: ReportModel): string[] {
  const m = model.metrics.medianLeadTimeHours;
  return [
    '## Median lead times (hours)', '',
    `Intent to spec: ${cell(m.intentToSpecApproval)} · Spec to plan: ${cell(m.specToPlanApproval)} · Plan to verified: ${cell(m.planToVerified)} · Verified to review: ${cell(m.verifiedToReviewApproval)} · Created to archived: ${cell(m.createdToArchived)}`,
    '',
  ];
}

function backlog(model: ReportModel): string[] {
  const { counts, epics, next, blocked } = model.backlog;
  const lines = [
    '## Backlog', '',
    `Open: ${counts.open} · In progress: ${counts['in-progress']} · Done: ${counts.done} · Dropped: ${counts.dropped}`,
    '',
  ];
  if (epics.length) {
    lines.push('| Epic | Done / total | In progress |', '| --- | ---: | ---: |');
    for (const epic of epics) {
      lines.push(`| ${cell(`${epic.id} ${epic.title}`)} | ${epic.done}/${epic.total} | ${epic.inProgress} |`);
    }
    lines.push('');
  }
  lines.push('### Next', '');
  if (next.length) {
    for (const item of next) lines.push(`- ${cell(item.id)} — ${cell(item.title)}`);
  } else {
    lines.push('- (none)');
  }
  lines.push('', '### Blocked', '');
  if (blocked.length) {
    for (const item of blocked) {
      lines.push(`- ${cell(item.id)} — ${cell(item.title)} (blocked by ${cell(item.blockedBy.join(', '))})`);
    }
  } else {
    lines.push('- (none)');
  }
  lines.push('');
  return lines;
}

function deferred(model: ReportModel): string[] {
  return ['## Deferred work', '', '| ID | Title | Change | Revisit when |', '| --- | --- | --- | --- |',
    ...model.deferred.items.map((item) => `| ${cell(item.id)} | ${cell(item.title)} | ${cell(item.change)} | ${cell(item.revisit)} |`), ''];
}

function events(model: ReportModel): string[] {
  return [
    '## Recent events', '',
    ...model.events.map((event) =>
      `- ${event.ts} ${event.change ? `${cell(event.change)}: ` : ''}${cell(event.event)}${event.detail ? ` — ${cell(event.detail)}` : ''}`),
    '',
  ];
}

function layout(model: ReportModel): string[] {
  const missing = model.layout.missingRequired.length
    ? ` Missing required: ${model.layout.missingRequired.join(', ')}.`
    : '';
  return [
    '## Layout readiness', '',
    `${model.layout.ready ? 'Ready' : 'Incomplete'} (${model.layout.score}%).${missing}`,
    '',
  ];
}

function footer(model: ReportModel): string {
  return `<sub>Generated by [scdl](${PROJECT_URL}) ${model.harness.version} · license: ${model.harness.license}</sub>`;
}

export function renderReportMarkdown(model: ReportModel): string {
  const lines = [
    `# ${cell(model.project.name)} SDLC progress (${model.period.since ?? 'all time'} to ${model.period.until})`,
    '',
    `${model.summary.active} active · ${model.summary.archived} archived · ${model.summary.blocked} blocked · ${model.summary.awaitingHuman} awaiting a person`,
    '',
    ...stages(model),
    ...changes(model),
    ...mermaidDiagrams(model),
    ...backlog(model),
    ...deferred(model),
    ...leadTimes(model),
    ...events(model),
    ...layout(model),
    footer(model),
  ];
  return lines.join('\n');
}
