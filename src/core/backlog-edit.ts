import type { ChangeKind, RiskLevel } from './change-state.js';
import { SdlcError } from './errors.js';
import {
  assertNoDependencyCycle,
  itemOrThrow,
  oneLine,
  readBacklog,
  save,
  validateItemInput,
  type BacklogItem,
} from './backlog.js';
import { assertUsableDependency } from './backlog-deps.js';

export interface BacklogEditInput {
  title?: string;
  outcome?: string;
  acceptance?: string[];
  addAcceptance?: string[];
  dependsOn?: string[];
  clearDepends?: boolean;
  kind?: ChangeKind;
  risk?: RiskLevel;
}

function validateEdit(input: BacklogEditInput): void {
  const fields = Object.entries(input).filter(([key, value]) =>
    key !== 'clearDepends' && value !== undefined && (!Array.isArray(value) || value.length > 0)
  );
  if (fields.length === 0 && !input.clearDepends) {
    throw new SdlcError('invalid_option', { key: 'error.backlog_edit_requires_field' });
  }
  if (input.clearDepends && input.dependsOn?.length) {
    throw new SdlcError('invalid_option', { key: 'error.backlog_edit_conflicting_depends' });
  }
  if (input.title !== undefined) {
    oneLine(input.title, 'title');
  }
  validateItemInput({
    title: input.title ?? 'valid',
    outcome: input.outcome,
    acceptance: [...(input.acceptance ?? []), ...(input.addAcceptance ?? [])],
    dependsOn: input.dependsOn,
    kind: input.kind,
    risk: input.risk,
  });
}

/** Refines an open item in place, without changing its section, status or position. */
export function editBacklogItem(root: string, id: string, input: BacklogEditInput): BacklogItem {
  const backlog = readBacklog(root);
  const item = itemOrThrow(backlog, id);
  if (item.status === 'done' || item.status === 'dropped') {
    throw new SdlcError('backlog_item_closed', {
      key: 'error.backlog_item_closed',
      params: { id },
    });
  }
  validateEdit(input);
  for (const dependency of input.dependsOn ?? []) {
    assertUsableDependency(itemOrThrow(backlog, dependency));
  }
  item.title = input.title ?? item.title;
  item.outcome = input.outcome ?? item.outcome;
  item.kind = input.kind ?? item.kind;
  item.risk = input.risk ?? item.risk;
  item.acceptance = [...(input.acceptance ?? item.acceptance), ...(input.addAcceptance ?? [])];
  item.dependsOn = input.clearDepends ? [] : input.dependsOn ?? item.dependsOn;
  assertNoDependencyCycle(backlog, [id]);
  save(root, backlog);
  return itemOrThrow(readBacklog(root), id);
}
