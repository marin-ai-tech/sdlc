import type { ReportModel, ReportChange } from './model.js';
import { PROJECT_URL } from '../core/license.js';
import { currentLocale, t } from '../core/i18n.js';
import { STAGES } from '../core/lifecycle.js';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const e = escapeHtml;
const number = (value: number | undefined, suffix = ''): string =>
  value === undefined ? '—' : `${e(value)}${suffix}`;
const tone = (status: string): string =>
  ['approved', 'passed', 'waived', 'canonical', 'mapped', 'alias'].includes(status)
    ? 'good'
    : ['rejected', 'failed', 'missing'].includes(status)
      ? 'bad'
      : ['n/a', 'never'].includes(status) ? 'muted' : 'waiting';
const pill = (label: string, status: string): string =>
  `<span class="pill ${tone(status)}">${e(label)}</span>`;
const stageLabel = (stage: string): string => t(`stage.${stage}`);

function header(model: ReportModel): string {
  const since = model.period.since ?? t('report.html.allTime');
  const period = t('report.html.period', { since, until: model.period.until });
  const generated = t('report.html.generated', {
    at: model.generatedAt,
    version: model.harness.version,
    license: model.harness.license,
  });
  return `<header class="hero"><div class="eyebrow">${e(t('report.html.eyebrow'))}</div>`
    + `<h1>${e(model.project.name)}</h1>`
    + `<p>${e(period)}</p>`
    + `<p class="small">${e(generated)}</p></header>`;
}

function overview(model: ReportModel): string {
  const rate = model.metrics.verifyFirstPassRate;
  const firstPass = number(rate === undefined ? undefined : rate * 100, '%');
  const median = number(model.metrics.medianLeadTimeHours.createdToArchived, ' h');
  const values: Array<[string, string | number]> = [
    [t('report.html.active'), model.summary.active],
    [t('report.html.archived'), model.summary.archived],
    [t('report.html.blocked'), model.summary.blocked],
    [t('report.html.awaiting'), model.summary.awaitingHuman],
    [t('report.html.verifyFirstPass'), firstPass],
    [t('report.html.medianCreated'), median],
  ];
  const kpis = values.map(([label, value]) =>
    `<div class="kpi"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join('');
  return `<section aria-labelledby="overview">`
    + `<h2 id="overview">${e(t('report.html.overview'))}</h2>`
    + `<div class="kpis">${kpis}</div></section>`;
}

function pipeline(model: ReportModel): string {
  const items = STAGES.map((stage) => {
    const count = model.summary.byStage.find((item) => item.stage === stage)?.count ?? 0;
    return `<li class="${count ? '' : 'empty'}"><span>${e(stageLabel(stage))}</span>`
      + `<strong>${e(count)}</strong></li>`;
  }).join('');
  return `<section aria-labelledby="pipeline">`
    + `<h2 id="pipeline">${e(t('report.html.pipeline'))}</h2>`
    + `<ol class="pipeline">${items}</ol></section>`;
}

function isChangeBlocked(change: ReportChange): boolean {
  return change.gates.some((gate) => gate.status === 'rejected')
    || change.verification === 'failed'
    || (change.review?.blockingOpen ?? 0) > 0;
}

function changeBadges(change: ReportChange, blocked: boolean): string {
  const risk = t('report.html.risk', { risk: change.risk });
  const parts = [
    pill(change.kind, 'n/a'),
    pill(risk, change.risk === 'high' ? 'pending' : 'n/a'),
    pill(change.track, 'n/a'),
  ];
  if (blocked) parts.push(pill(t('report.html.blockedPill'), 'failed'));
  return parts.join(' ');
}

function changeGates(change: ReportChange): string {
  return change.gates.map((gate) => {
    const optional = gate.required ? '' : t('report.html.optional');
    return pill(`${gate.id}: ${gate.status}${optional}`, gate.status);
  }).join(' ');
}

function changeWarnings(change: ReportChange): string {
  if (!change.warnings.length) return '';
  const items = change.warnings.map((w) => `<li>${e(w)}</li>`).join('');
  return `<div class="warnings"><strong>${e(t('report.html.warnings'))}</strong>`
    + `<ul>${items}</ul></div>`;
}

function changeStepper(change: ReportChange): string {
  return STAGES.map((stage) =>
    `<li class="${stage === change.stage ? 'current' : ''}">${e(stageLabel(stage))}</li>`).join('');
}

function changeGrid(change: ReportChange, progress: number): string {
  const tasks = t('report.html.tasks', {
    complete: change.tasks.complete,
    total: change.tasks.total,
  });
  const reviewOpen = t('report.html.blockingOpen', { open: change.review?.blockingOpen ?? 0 });
  const reviewTotal = change.review
    ? t('report.html.ofTotal', { total: change.review.total })
    : '';
  return `<div class="change-grid"><div><strong>${e(tasks)}</strong>`
    + `<div class="track"><span style="width:${progress}%"></span></div></div>`
    + `<p><strong>${e(t('report.html.verification'))}</strong><br>`
    + `${pill(change.verification, change.verification)}</p>`
    + `<p><strong>${e(t('report.html.reviewFindings'))}</strong><br>`
    + `${e(reviewOpen)}${e(reviewTotal)}</p></div>`;
}

function changeCard(change: ReportChange): string {
  const blocked = isChangeBlocked(change);
  const progress = change.tasks.total > 0
    ? Math.min(100, Math.max(0, change.tasks.complete / change.tasks.total * 100))
    : 0;
  const actorKey = change.next.actor === 'human' ? 'actor.person' : `actor.${change.next.actor}`;
  const cli = change.next.cli ? `<code>${e(change.next.cli)}</code>` : '';
  return `<article class="change ${blocked ? 'blocked' : ''}">`
    + `<div class="change-top"><div><h3>${e(change.id)}</h3>`
    + `<p class="badges">${changeBadges(change, blocked)}</p></div>`
    + `<span class="stage-label">${e(stageLabel(change.stage))}</span></div>`
    + `<ol class="stepper" aria-label="Lifecycle stages">${changeStepper(change)}</ol>`
    + `<div class="gate-list"><strong>${e(t('report.html.gates'))}</strong> ${changeGates(change)}</div>`
    + changeGrid(change, progress)
    + `<div class="next"><strong>${e(t('report.html.next', { actor: t(actorKey) }))}</strong>`
    + `<p>${e(change.next.message)}</p>${cli}</div>`
    + changeWarnings(change)
    + `</article>`;
}

function changes(model: ReportModel): string {
  const body = model.changes.length
    ? `<div class="changes">${model.changes.map(changeCard).join('')}</div>`
    : `<p>${e(t('report.html.noChanges'))}</p>`;
  return `<section aria-labelledby="changes">`
    + `<h2 id="changes">${e(t('report.html.changes'))}</h2>${body}</section>`;
}

function leadTimes(model: ReportModel): string {
  const lead = model.metrics.medianLeadTimeHours;
  const rows = [
    [t('report.html.leadIntentSpec'), lead.intentToSpecApproval],
    [t('report.html.leadSpecPlan'), lead.specToPlanApproval],
    [t('report.html.leadPlanVerified'), lead.planToVerified],
    [t('report.html.leadVerifiedReview'), lead.verifiedToReviewApproval],
    [t('report.html.leadCreatedArchived'), lead.createdToArchived],
  ] as const;
  const max = Math.max(1, ...rows.map(([, value]) => value ?? 0));
  const bars = rows.map(([label, value]) => {
    const width = value === undefined ? 0 : Math.min(100, value / max * 100);
    return `<div class="bar-row"><span>${e(label)}</span>`
      + `<div class="track"><span style="width:${width}%"></span></div>`
      + `<strong>${number(value, ' h')}</strong></div>`;
  }).join('');
  return `<section aria-labelledby="lead">`
    + `<h2 id="lead">${e(t('report.html.medianLead'))}</h2>`
    + `<div class="bars">${bars}</div></section>`;
}

function epicCard(epic: ReportModel['backlog']['epics'][number]): string {
  const progress = epic.total > 0
    ? Math.min(100, Math.max(0, epic.done / epic.total * 100))
    : 0;
  const goal = epic.goal ? `<p class="small">${e(epic.goal)}</p>` : '';
  const doneOf = t('report.html.doneOf', { done: epic.done, total: epic.total });
  const progressLabel = t('report.html.progress', { done: epic.done, total: epic.total });
  const epicCounts = t('report.html.epicCounts', {
    open: epic.open,
    inProgress: epic.inProgress,
    done: epic.done,
    dropped: epic.dropped,
  });
  return `<article class="change"><div class="change-top"><div>`
    + `<h3>${e(epic.id)} ${e(epic.title)}</h3>${goal}</div>`
    + `<span class="stage-label">${e(doneOf)}</span></div>`
    + `<div><strong>${e(progressLabel)}</strong>`
    + `<div class="track"><span style="width:${progress}%"></span></div>`
    + `<p class="small">${e(epicCounts)}</p></div></article>`;
}

function backlogLists(model: ReportModel): { nextList: string; blockedList: string } {
  const { next, blocked } = model.backlog;
  const nextList = next.length
    ? `<ul class="roles">${next.map((item) =>
      `<li><strong>${e(item.id)}</strong><span>${e(item.title)}</span></li>`).join('')}</ul>`
    : `<p>${e(t('report.html.noReady'))}</p>`;
  const blockedList = blocked.length
    ? `<ul class="roles">${blocked.map((item) => {
      const by = t('report.html.blockedBy', { ids: item.blockedBy.join(', ') });
      return `<li><strong>${e(item.id)}</strong><span>${e(item.title)}</span>`
        + `<span>${e(by)}</span></li>`;
    }).join('')}</ul>`
    : `<p>${e(t('report.html.nothingBlocked'))}</p>`;
  return { nextList, blockedList };
}

function backlog(model: ReportModel): string {
  const { counts, epics, next, blocked } = model.backlog;
  const empty = epics.length === 0 && next.length === 0 && blocked.length === 0
    && counts.open === 0 && counts['in-progress'] === 0 && counts.done === 0 && counts.dropped === 0;
  if (empty) {
    return `<section aria-labelledby="backlog"><h2 id="backlog">${e(t('report.html.backlog'))}</h2>`
      + `<p>${e(t('report.html.noBacklog'))}</p></section>`;
  }
  const epicBlocks = epics.map(epicCard).join('');
  const { nextList, blockedList } = backlogLists(model);
  const countsLine = t('report.html.backlogCounts', {
    open: counts.open,
    inProgress: counts['in-progress'],
    done: counts.done,
    dropped: counts.dropped,
  });
  return `<section aria-labelledby="backlog"><h2 id="backlog">${e(t('report.html.backlog'))}</h2>`
    + `<p>${e(countsLine)}</p>`
    + `${epicBlocks ? `<div class="changes">${epicBlocks}</div>` : ''}`
    + `<h3>${e(t('report.html.nextUp'))}</h3>${nextList}`
    + `<h3>${e(t('report.html.blocked'))}</h3>${blockedList}</section>`;
}

function deferred(model: ReportModel): string {
  const body = model.deferred.items.length
    ? `<ul class="roles">${model.deferred.items.map((item) =>
      `<li><strong>${e(item.id)}</strong><span>${e(item.title)}</span>`
        + `<span>${e(item.change ?? '')} ${e(item.revisit ?? '')}</span></li>`).join('')}</ul>`
    : `<p>${e(t('report.html.noDeferred'))}</p>`;
  return `<section aria-labelledby="deferred">`
    + `<h2 id="deferred">${e(t('report.html.deferred'))}</h2>${body}</section>`;
}

function timeline(model: ReportModel): string {
  const body = model.events.length
    ? `<ol class="timeline">${[...model.events].reverse().map((event) => {
      const change = event.change ? ` · ${e(event.change)}` : '';
      const by = event.by ? ` · ${e(event.by)}` : '';
      const detail = event.detail ? `<p>${e(event.detail)}</p>` : '';
      return `<li><time>${e(event.ts)}</time><div><strong>${e(event.event)}</strong>`
        + `${change}${by}${detail}</div></li>`;
    }).join('')}</ol>`
    : `<p>${e(t('report.html.noEvents'))}</p>`;
  return `<section aria-labelledby="timeline">`
    + `<h2 id="timeline">${e(t('report.html.timeline'))}</h2>${body}</section>`;
}

function layout(model: ReportModel): string {
  const missing = new Set(model.layout.missingRequired);
  const ready = model.layout.ready ? t('report.html.ready') : t('report.html.notReady');
  const roles = model.layout.roles.map((role) => {
    const req = missing.has(role.role) ? t('report.html.required') : '';
    const path = e(role.path ?? t('report.html.noPath'));
    return `<li class="${missing.has(role.role) ? 'required-missing' : ''}">`
      + `<strong>${e(role.role)}</strong>${pill(role.status, role.status)}`
      + `<span>${path}${e(req)}</span></li>`;
  }).join('');
  const warnings = model.layout.warnings.length
    ? `<ul class="warnings">${model.layout.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul>`
    : '';
  const width = Math.max(0, Math.min(100, model.layout.score));
  return `<section aria-labelledby="layout">`
    + `<h2 id="layout">${e(t('report.html.layout'))}</h2>`
    + `<p class="readiness"><strong>${e(model.layout.score)}%</strong> · ${e(ready)}</p>`
    + `<div class="track meter" role="meter" aria-label="Layout readiness" `
    + `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(model.layout.score)}">`
    + `<span style="width:${width}%"></span></div>`
    + `<ul class="roles">${roles}</ul>${warnings}</section>`;
}

const css = `:root{color-scheme:light;--bg:#f4f6fa;--panel:#fff;--text:#18253b;--sub:#52627b;--line:#dbe2eb;--accent:#2858c7;--soft:#eaf0ff;--good:#17644d;--good-bg:#e4f5ed;--bad:#a33239;--bad-bg:#fcecee;--wait:#805312;--wait-bg:#fff3d9;--muted:#586477;--muted-bg:#edf0f4}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;overflow-wrap:anywhere}main,footer{max-width:1200px;margin:auto;padding:0 20px}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(2rem,5vw,3.3rem);line-height:1.1}h2{font-size:1.4rem}h3{font-size:1.15rem;margin-bottom:8px}p{margin-bottom:10px}section{margin:30px 0}section>h2{margin-bottom:15px}.hero{background:linear-gradient(125deg,#142b5c,#265cc3);color:white;padding:48px max(20px,calc((100vw - 1160px)/2));}.hero p{color:#e5eeff}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-weight:700;font-size:.8rem;margin-bottom:12px}.small{font-size:.85rem}.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.kpi,.change,.bars,.timeline,.roles,.pipeline{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 18px #142b5c0a}.kpi{padding:18px}.kpi span{display:block;color:var(--sub);font-size:.85rem}.kpi strong{font-size:1.8rem}.pipeline{list-style:none;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));padding:8px;margin:0;gap:6px}.pipeline li{background:var(--soft);padding:14px;border-radius:10px;min-width:0}.pipeline li span{display:block;font-size:.8rem}.pipeline li strong{font-size:1.45rem}.pipeline .empty{opacity:.6}.changes{display:grid;gap:15px}.change{padding:20px;border-left:5px solid var(--accent)}.change.blocked{border-left-color:var(--bad);background:var(--bad-bg)}.change-top{display:flex;justify-content:space-between;gap:12px;align-items:start}.stage-label{color:var(--sub);text-align:right}.badges{display:flex;flex-wrap:wrap;gap:5px}.pill{display:inline-block;border-radius:99px;padding:2px 9px;font-size:.76rem;font-weight:700;margin:2px}.pill.good{background:var(--good-bg);color:var(--good)}.pill.bad{background:var(--bad-bg);color:var(--bad)}.pill.waiting{background:var(--wait-bg);color:var(--wait)}.pill.muted{background:var(--muted-bg);color:var(--muted)}.stepper{list-style:none;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px;padding:0;margin:16px 0}.stepper li{border-top:4px solid var(--line);padding-top:5px;color:var(--sub);font-size:.72rem}.stepper li.current{border-color:var(--accent);color:var(--text);font-weight:700}.gate-list{margin:14px 0}.change-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:15px;align-items:start}.track{height:10px;background:var(--muted-bg);border-radius:10px;overflow:hidden;margin-top:8px}.track span{display:block;height:100%;background:var(--accent);border-radius:10px}.next{background:var(--soft);padding:12px;border-radius:9px}.next p{margin:4px 0}code{display:inline-block;max-width:100%;white-space:normal;background:var(--panel);padding:4px 7px;border-radius:4px}.warnings{color:var(--bad);margin-top:12px}.warnings ul{margin:5px 0}.bars{padding:18px}.bar-row{display:grid;grid-template-columns:170px 1fr 65px;gap:12px;align-items:center;margin:8px 0}.bar-row .track{margin:0}.bar-row strong{text-align:right}.timeline{list-style:none;padding:8px 18px;margin:0}.timeline li{display:grid;grid-template-columns:190px 1fr;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}.timeline li:last-child{border:0}.timeline time{color:var(--sub);font-size:.85rem}.timeline p{margin:3px 0}.readiness strong{font-size:1.8rem}.meter{height:14px}.roles{list-style:none;padding:8px 18px;margin:15px 0}.roles li{display:grid;grid-template-columns:160px 90px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);align-items:center}.roles li:last-child{border:0}.required-missing{color:var(--bad)}footer{padding-top:14px;padding-bottom:35px;color:var(--sub)}a{color:var(--accent)}@media(max-width:750px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(3,minmax(0,1fr))}.change-grid{grid-template-columns:1fr 1fr}.stepper{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:480px){main,footer{padding-left:14px;padding-right:14px}.hero{padding:30px 14px}.kpis{gap:8px}.kpi{padding:12px}.kpi strong{font-size:1.4rem}.pipeline{grid-template-columns:repeat(2,minmax(0,1fr))}.change{padding:13px}.change-top{display:block}.stage-label{text-align:left}.change-grid{grid-template-columns:1fr}.bar-row{grid-template-columns:105px 1fr 48px;gap:6px;font-size:.8rem}.timeline li{grid-template-columns:1fr;gap:2px}.roles li{grid-template-columns:1fr 1fr;gap:2px}.roles li>span:last-child{grid-column:1/-1}}@media (prefers-color-scheme: dark){:root{color-scheme:dark;--bg:#101827;--panel:#1c293b;--text:#eaf0fa;--sub:#aebed3;--line:#33445b;--accent:#88afff;--soft:#233b62;--good:#a4e5c7;--good-bg:#1d4b3e;--bad:#ffb1b6;--bad-bg:#4b2630;--wait:#ffda95;--wait-bg:#57421d;--muted:#c1ccda;--muted-bg:#334154}}`;

export function renderReportHtml(model: ReportModel): string {
  const lang = currentLocale();
  const title = t('report.html.title', { name: model.project.name });
  const main = overview(model)
    + pipeline(model)
    + changes(model)
    + backlog(model)
    + deferred(model)
    + leadTimes(model)
    + timeline(model)
    + layout(model);
  const footer = `${e(t('report.html.footerPrefix'))} `
    + `<a href="${PROJECT_URL}">sdlc</a> ${e(model.harness.version)} · ${e(model.harness.license)}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${e(title)}</title><style>${css}</style></head>`
    + `<body>${header(model)}<main>${main}</main>`
    + `<footer>${footer}</footer></body></html>`;
}
