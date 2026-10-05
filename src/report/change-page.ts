/**
 * The dashboard page of one change (B8): a section that brings together what 0.8.0 records for it - the timeline
 * of its history events, how long its gates waited for a person (the audit metrics of B6), the reworks with their
 * reason category, the gaps `sdlc trace` finds and who acts now, by name when openspec/roles.yaml exists. The data
 * is built with the report model; the HTML stays one offline file and every text comes from the catalog.
 */
import type { ChangeRef } from '../core/changes.js';
import type { ChangeState } from '../core/change-state.js';
import type { SdlcConfig } from '../core/config.js';
import type { MessageParams } from '../core/i18n.js';
import type { LifecycleView } from '../core/lifecycle.js';
import type { ChangeMetrics } from '../core/metrics.js';
import type { NamedApprover } from '../core/named-approvers.js';
import { t } from '../core/i18n.js';
import { openGateDeciders } from '../core/named-approvers.js';
import { buildTrace, type TraceGap } from '../core/trace.js';

export interface ChangePageEvent {
  at: string;
  event: string;
  by?: string;
  detail?: string;
}

export interface ChangePage {
  /** The change's history events, oldest first. */
  history: ChangePageEvent[];
  /** Seconds each approval gate waited for a person (B6). */
  waits: Array<{ gate: string; seconds: number }>;
  reworks: ChangeMetrics['reworks'];
  /** The gaps of `sdlc trace`. */
  gaps: TraceGap[];
  /** The next step; `people` names who may take it (with roles.yaml). Text is English, `key` localizes it. */
  now: { message: string; key?: string; params?: MessageParams; people: NamedApprover[] };
  /** With roles.yaml: the open approval gate and the people who may decide it now. */
  deciders?: { gate: string; people: NamedApprover[] };
}

/** What one change page is built from. */
export interface ChangePageInput {
  root: string;
  config: SdlcConfig;
  ref: ChangeRef;
  state: ChangeState;
  view: LifecycleView;
  metrics: ChangeMetrics;
}

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const e = escapeHtml;

/** The anchor of a change's section, linked from the changes list. */
export function changeAnchor(id: string): string {
  return `change-${id}`;
}

function traceGaps(root: string, ref: ChangeRef): TraceGap[] {
  try {
    return buildTrace(root, ref).gaps;
  } catch {
    // A trace that cannot be built (for example git is missing) leaves the page without gaps, not without a page.
    return [];
  }
}

function pageEvent(event: ChangeState['history'][number]): ChangePageEvent {
  const by = event.by ? { by: event.by } : {};
  const detail = event.detail ? { detail: event.detail } : {};
  return { at: event.at, event: event.event, ...by, ...detail };
}

function nowOf(view: LifecycleView): ChangePage['now'] {
  const next = view.next;
  const key = next.key ? { key: next.key } : {};
  const params = next.params ? { params: next.params } : {};
  return { message: next.message, ...key, ...params, people: next.people ?? [] };
}

function decidersOf(input: ChangePageInput): Pick<ChangePage, 'deciders'> {
  try {
    const deciders = openGateDeciders(input.root, input.config, input.view, input.state);
    return deciders ? { deciders } : {};
  } catch {
    // The names are a hint: a roles check that fails leaves the page with the next step alone.
    return {};
  }
}

/** The page data of one change. Read-only. */
export function buildChangePage(input: ChangePageInput): ChangePage {
  const waits = Object.entries(input.metrics.waits).map(([gate, wait]) => ({ gate, seconds: wait.seconds }));
  return {
    history: input.state.history.map(pageEvent),
    waits,
    reworks: input.metrics.reworks,
    gaps: traceGaps(input.root, input.ref),
    now: nowOf(input.view),
    ...decidersOf(input),
  };
}

function duration(seconds: number): string {
  if (seconds < 60) return t('report.html.durationSeconds', { n: seconds });
  if (seconds < 3600) return t('report.html.durationMinutes', { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t('report.html.durationHours', { n: Math.round(seconds / 360) / 10 });
  return t('report.html.durationDays', { n: Math.round(seconds / 8640) / 10 });
}

/** A titled block with a list, or the "nothing here" text when the list is empty. */
function block(title: string, items: string[], empty: string, listClass = ''): string {
  const list = items.length
    ? `<ul${listClass ? ` class="${listClass}"` : ''}>${items.join('')}</ul>`
    : `<p class="small">${e(empty)}</p>`;
  return `<div class="page-block"><h4>${e(title)}</h4>${list}</div>`;
}

function historyItem(event: ChangePageEvent): string {
  const by = event.by ? ` · ${e(event.by)}` : '';
  const detail = event.detail ? `<p>${e(event.detail)}</p>` : '';
  return `<li><time>${e(event.at)}</time><div><strong>${e(event.event)}</strong>${by}${detail}</div></li>`;
}

function historyBlock(page: ChangePage): string {
  const items = page.history.map(historyItem);
  const list = items.length
    ? `<ol class="timeline">${items.join('')}</ol>`
    : `<p class="small">${e(t('report.html.pageNoHistory'))}</p>`;
  return `<div class="page-block page-wide"><h4>${e(t('report.html.pageHistory'))}</h4>${list}</div>`;
}

function waitsBlock(page: ChangePage): string {
  const items = page.waits.map((wait) => {
    const text = t('report.html.pageWait', { gate: wait.gate, duration: duration(wait.seconds) });
    return `<li>${e(text)}</li>`;
  });
  return block(t('report.html.pageWaits'), items, t('report.html.pageNoWaits'));
}

function reworksBlock(page: ChangePage): string {
  const items = page.reworks.map((rework) => {
    const text = t('report.html.pageRework', { gate: rework.gate, reason: rework.reason, at: rework.at });
    return `<li>${e(text)}</li>`;
  });
  return block(t('report.html.pageReworks'), items, t('report.html.pageNoReworks'));
}

function gapsBlock(page: ChangePage): string {
  const items = page.gaps.map((gap) => `<li>${e(t(`trace.gap.${gap.kind}`, { ref: gap.ref }))}</li>`);
  return block(t('report.html.pageGaps'), items, t('report.html.pageNoGaps'), 'warnings');
}

function peopleList(people: NamedApprover[]): string {
  const items = people.map((person) =>
    `<li><strong>${e(person.name)}</strong> <span class="small">${e(person.role)}</span></li>`);
  return items.length ? `<ul>${items.join('')}</ul>` : '';
}

/** The people of the next step, or else those who may decide the open gate. */
function nowPeople(page: ChangePage): string {
  if (page.now.people.length > 0) return peopleList(page.now.people);
  const deciders = page.deciders;
  if (!deciders || deciders.people.length === 0) return '';
  const label = t('report.html.pageDeciders', { gate: deciders.gate });
  return `<p class="small">${e(label)}</p>${peopleList(deciders.people)}`;
}

function nowBlock(page: ChangePage): string {
  const now = page.now;
  const text = now.key ? t(now.key, now.params) : now.message;
  const step = text ? `<p>${e(text)}</p>` : `<p class="small">${e(t('report.html.pageNothingNow'))}</p>`;
  return `<div class="page-block next"><h4>${e(t('report.html.pageNow'))}</h4>${step}${nowPeople(page)}</div>`;
}

/** One `<section id="change-<id>">`; it holds no nested section, so its `</section>` closes it. */
export function renderChangePage(change: { id: string; page: ChangePage }): string {
  const anchor = e(changeAnchor(change.id));
  return `<section id="${anchor}" class="change change-page" aria-labelledby="${anchor}-title">`
    + `<h3 id="${anchor}-title">${e(t('report.html.pageTitle', { change: change.id }))}</h3>`
    + `<div class="page-grid">${nowBlock(change.page)}${waitsBlock(change.page)}`
    + `${reworksBlock(change.page)}${gapsBlock(change.page)}${historyBlock(change.page)}</div>`
    + `</section>`;
}

/** The per-change pages, after the changes list. */
export function renderChangePages(changes: Array<{ id: string; page: ChangePage }>): string {
  if (changes.length === 0) return '';
  return `<div class="change-pages">`
    + `<h2 id="change-pages">${e(t('report.html.pages'))}</h2>`
    + `<div class="changes">${changes.map(renderChangePage).join('')}</div></div>`;
}

export const CHANGE_PAGE_CSS = [
  '.change-pages{margin:30px 0}',
  '.change-page h4{margin:0 0 6px;font-size:.95rem}',
  '.change-page ul{margin:0;padding-left:18px}',
  '.page-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;align-items:start}',
  '.page-wide{grid-column:1/-1}',
  '.change-page .timeline{box-shadow:none}',
  '@media(max-width:750px){.page-grid{grid-template-columns:1fr}}',
].join('');
