import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { readChangeState } from '../core/change-state.js';
import { assertValidChangeId } from '../core/changes.js';
import { addDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { isWithin } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { planBmadImport } from '../core/import-bmad.js';
import { createChange } from './changes.js';
import { addBacklogItem, addEpic } from '../core/backlog.js';
import { planBmadBacklog } from '../core/bmad-tickets.js';
import { appendLog } from '../core/log.js';
import { t } from '../core/i18n.js';

export function importBmadCommand(input: string, opts: { change?: string; toBacklog?: boolean; kind?: string; risk?: string; dryRun?: boolean; json?: boolean }): void {
  try {
    if (!!opts.change === !!opts.toBacklog) {
      throw new SdlcError('invalid_option', { key: 'error.supply_exactly_one_of_change_or_to_backlog' });
    }
    if (opts.toBacklog) {
      const ctx = loadProject();
      const plan = planBmadBacklog(ctx.root, input);
      if (opts.dryRun) {
        if (opts.json) printJson(plan);
        else line(JSON.stringify(plan, null, 2));
        return;
      }
      const epicIds = new Map<string, string>();
      const itemIds = new Map<string, string>();
      const epics = plan.epics.map(epic => {
        const created = addEpic(ctx.root, epic);
        epicIds.set(epic.key, created.id);
        return created;
      });
      const items = plan.items.map(item => {
        const { key, epicKey, dependsOnKeys, ...fields } = item;
        const dependsOn = dependsOnKeys.map(dep => {
          const resolved = itemIds.get(dep);
          if (!resolved) throw new SdlcError(
            'invalid_tickets',
            { key: 'error.dependency_x_is_not_earlier_in_build_order', params: { dep: dep } }
          );
          return resolved;
        });
        const created = addBacklogItem(ctx.root, { ...fields, epic: epicKey ? epicIds.get(epicKey) : undefined,
          dependsOn });
        itemIds.set(key, created.id);
        return created;
      });
      appendLog(ctx.root, ctx.config, { event: 'backlog.imported',
        by: formatIdentity(gitIdentity(ctx.root)), detail: `${epics.length} epics, ${items.length} items` }, ctx.stamp);
      if (opts.json) printJson({ epics, items, unmapped: plan.unmapped, warnings: plan.warnings });
      else line(t('import.backlogDone', { epics: epics.length, items: items.length }));
      return;
    }
    const changeId = opts.change!;
    assertValidChangeId(changeId);
    const ctx = loadProject();
    const target = path.join(ctx.paths.changesDir, changeId);
    if (fs.existsSync(target)) throw new SdlcError(
      'change_exists',
      { key: 'error.change_x_already_exists', params: { opts_change: opts.change ?? '' } }
    );
    const plan = planBmadImport(ctx.root, input, changeId);
    if (opts.dryRun) { if (opts.json) printJson(plan); else line(JSON.stringify(plan, null, 2)); return; }
    const { dir } = createChange(changeId, { kind: opts.kind, risk: opts.risk, sourceType: 'bmad', sourceRef: input });
    for (const file of plan.files) {
      const dest = path.resolve(dir, file.path);
      if (!isWithin(dir, dest)) throw new SdlcError('invalid_path', { key: 'error.import_path_escapes_change_folder' });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf8');
    }
    const sourceDir = path.join(dir, 'sources', 'bmad');
    fs.mkdirSync(sourceDir, { recursive: true });
    for (const doc of plan.docs) {
      const source = path.resolve(ctx.root, doc.path);
      const dest = path.resolve(sourceDir, path.basename(doc.path));
      if (!isWithin(sourceDir, dest) || fs.lstatSync(source).isSymbolicLink()) throw new SdlcError(
        'invalid_path',
        { key: 'error.invalid_bmad_source' }
      );
      fs.copyFileSync(source, dest);
    }
    const by = formatIdentity(gitIdentity(ctx.root));
    for (const item of plan.deferred) addDeferred(ctx.root, { ...item, change: changeId, by });
    recordChangeEvent(ctx, { id: changeId, dir }, readChangeState(dir), 'change.imported', by, input);
    const next = resolveNext(ctx, changeId);
    if (opts.json) printJson({ ...plan, ...(next ? { next } : {}) });
    else {
      line(t('import.changeDone', { change: changeId }));
      emitNextHint(ctx, changeId);
    }
  } catch (error) { reportFailure(error, opts.json); }
}
