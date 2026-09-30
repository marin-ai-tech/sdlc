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

export function importBmadCommand(input: string, opts: { change?: string; toBacklog?: boolean; kind?: string; risk?: string; dryRun?: boolean; json?: boolean }): void {
  try {
    if (!!opts.change === !!opts.toBacklog) {
      throw new SdlcError('invalid_option', 'Supply exactly one of --change or --to-backlog.');
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
          if (!resolved) throw new SdlcError('invalid_tickets', `Dependency ${dep} is not earlier in build order.`);
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
      else line(`Imported ${epics.length} epics and ${items.length} backlog items.`);
      return;
    }
    const changeId = opts.change!;
    assertValidChangeId(changeId);
    const ctx = loadProject();
    const target = path.join(ctx.paths.changesDir, changeId);
    if (fs.existsSync(target)) throw new SdlcError('change_exists', `Change ${opts.change} already exists.`);
    const plan = planBmadImport(ctx.root, input, changeId);
    if (opts.dryRun) { if (opts.json) printJson(plan); else line(JSON.stringify(plan, null, 2)); return; }
    const { dir } = createChange(changeId, { kind: opts.kind, risk: opts.risk, sourceType: 'bmad', sourceRef: input });
    for (const file of plan.files) {
      const dest = path.resolve(dir, file.path);
      if (!isWithin(dir, dest)) throw new SdlcError('invalid_path', 'Import path escapes change folder.');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf8');
    }
    const sourceDir = path.join(dir, 'sources', 'bmad');
    fs.mkdirSync(sourceDir, { recursive: true });
    for (const doc of plan.docs) {
      const source = path.resolve(ctx.root, doc.path);
      const dest = path.resolve(sourceDir, path.basename(doc.path));
      if (!isWithin(sourceDir, dest) || fs.lstatSync(source).isSymbolicLink()) throw new SdlcError('invalid_path', 'Invalid BMAD source.');
      fs.copyFileSync(source, dest);
    }
    const by = formatIdentity(gitIdentity(ctx.root));
    for (const item of plan.deferred) addDeferred(ctx.root, { ...item, change: changeId, by });
    recordChangeEvent(ctx, { id: changeId, dir }, readChangeState(dir), 'change.imported', by, input);
    const next = resolveNext(ctx, changeId);
    if (opts.json) printJson({ ...plan, ...(next ? { next } : {}) });
    else {
      line(`Imported BMAD artifacts into ${changeId}.`);
      emitNextHint(ctx, changeId);
    }
  } catch (error) { reportFailure(error, opts.json); }
}
