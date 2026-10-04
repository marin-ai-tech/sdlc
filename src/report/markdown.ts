import type { ReportChange, ReportModel } from './model.js';
import { PROJECT_URL } from '../core/license.js';
import { t } from '../core/i18n.js';
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
    `## ${t('report.stages')}`, '',
    `| ${t('report.stageCol')} | ${t('report.activeCol')} |`,
    '| --- | ---: |',
    ...model.summary.byStage.map((stage) =>
      `| ${cell(t(`stage.${stage.stage}`))} | ${stage.count} |`),
    '',
  ];
}

function changeRow(change: ReportChange): string {
  const stage = cell(t(`stage.${change.stage}`));
  const tasks = `${change.tasks.complete}/${change.tasks.total}`;
  const verify = cell(change.verification);
  const next = cell(change.next.message);
  return `| ${cell(change.id)} | ${stage} | ${tasks} | ${verify} | ${next} |`;
}

function changes(model: ReportModel): string[] {
  const header = [
    t('report.changeCol'),
    t('report.stageCol'),
    t('report.tasksCol'),
    t('report.verificationCol'),
    t('report.nextCol'),
  ].join(' | ');
  return [
    `## ${t('report.changes')}`, '',
    `| ${header} |`,
    '| --- | --- | --- | --- | --- |',
    ...model.changes.map(changeRow),
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
    lines.push(`## ${t('report.lifecycleDiagrams')}`, '');
    for (const change of active) {
      lines.push(...changeFlowchart(change));
    }
  }
  if (model.backlog.epics.length) {
    lines.push(`## ${t('report.epicProgress')}`, '');
    lines.push(...epicFlowchart(model));
  }
  return lines;
}

function leadTimes(model: ReportModel): string[] {
  const m = model.metrics.medianLeadTimeHours;
  return [
    `## ${t('report.medianLeadTimes')}`, '',
    t('report.leadLine', {
      a: cell(m.intentToSpecApproval),
      b: cell(m.specToPlanApproval),
      c: cell(m.planToVerified),
      d: cell(m.verifiedToReviewApproval),
      e: cell(m.createdToArchived),
    }),
    '',
  ];
}

function backlog(model: ReportModel): string[] {
  const { counts, epics, next, blocked } = model.backlog;
  const lines = [
    `## ${t('report.backlog')}`, '',
    t('report.backlogCounts', {
      open: counts.open,
      inProgress: counts['in-progress'],
      done: counts.done,
      dropped: counts.dropped,
    }),
    '',
  ];
  if (epics.length) {
    lines.push(
      `| ${t('report.epicCol')} | ${t('report.doneTotalCol')} | ${t('report.inProgressCol')} |`,
      '| --- | ---: | ---: |',
    );
    for (const epic of epics) {
      lines.push(`| ${cell(`${epic.id} ${epic.title}`)} | ${epic.done}/${epic.total} | ${epic.inProgress} |`);
    }
    lines.push('');
  }
  lines.push(`### ${t('report.nextHeading')}`, '');
  if (next.length) {
    for (const item of next) lines.push(`- ${cell(item.id)} — ${cell(item.title)}`);
  } else {
    lines.push(`- ${t('report.none')}`);
  }
  lines.push('', `### ${t('report.blockedHeading')}`, '');
  if (blocked.length) {
    for (const item of blocked) {
      const by = t('report.blockedBy', { ids: item.blockedBy.join(', ') });
      lines.push(`- ${cell(item.id)} — ${cell(item.title)} (${by})`);
    }
  } else {
    lines.push(`- ${t('report.none')}`);
  }
  lines.push('');
  return lines;
}

function deferred(model: ReportModel): string[] {
  return [
    `## ${t('report.deferred')}`, '',
    `| ${t('report.idCol')} | ${t('report.titleCol')} | ${t('report.changeCol')} | ${t('report.revisitCol')} |`,
    '| --- | --- | --- | --- |',
    ...model.deferred.items.map((item) =>
      `| ${cell(item.id)} | ${cell(item.title)} | ${cell(item.change)} | ${cell(item.revisit)} |`),
    '',
  ];
}

function events(model: ReportModel): string[] {
  return [
    `## ${t('report.recentEvents')}`, '',
    ...model.events.map((event) => {
      const who = event.change ? `${cell(event.change)}: ` : '';
      const detail = event.detail ? ` — ${cell(event.detail)}` : '';
      return `- ${event.ts} ${who}${cell(event.event)}${detail}`;
    }),
    '',
  ];
}

function layout(model: ReportModel): string[] {
  const missing = model.layout.missingRequired.length
    ? t('report.layoutMissing', { missing: model.layout.missingRequired.join(', ') })
    : '';
  const state = model.layout.ready ? t('report.layoutReady') : t('report.layoutIncomplete');
  return [
    `## ${t('report.layout')}`, '',
    t('report.layoutLine', { state, score: model.layout.score, missing }),
    '',
  ];
}

function footer(model: ReportModel): string {
  return `<sub>${t('report.footer', {
    url: PROJECT_URL,
    version: model.harness.version,
    license: model.harness.license,
  })}</sub>`;
}

export function renderReportMarkdown(model: ReportModel): string {
  const since = model.period.since ?? t('report.allTime');
  const lines = [
    `# ${t('report.title', { name: cell(model.project.name), since, until: model.period.until })}`,
    '',
    t('report.summaryLine', {
      active: model.summary.active,
      archived: model.summary.archived,
      blocked: model.summary.blocked,
      awaiting: model.summary.awaitingHuman,
    }),
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
