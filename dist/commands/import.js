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
import { addBacklogItem, addEpic, readBacklog } from '../core/backlog.js';
import { planBmadBacklog } from '../core/bmad-tickets.js';
import { appendLog } from '../core/log.js';
import { t } from '../core/i18n.js';
function printBacklogPreview(plan) {
    line(t('import.backlogPreview'));
    for (const epic of plan.epics)
        line(t('import.previewEpic', { title: epic.title }));
    for (const item of plan.items)
        line(t('import.previewItem', { title: item.title }));
    line(t('import.previewCounts', { warnings: plan.warnings.length, unmapped: plan.unmapped.length }));
    for (const warning of plan.warnings)
        line(t('import.previewWarning', { warning }));
}
function printChangePreview(plan) {
    line(t('import.changePreview', { change: plan.change }));
    for (const file of plan.files)
        line(t('import.previewFile', { path: file.path }));
}
function importedEpicSource(root, input, key) {
    const folder = path.relative(root, path.resolve(root, input)).split(path.sep).join('/');
    return `bmad ${folder}#${key}`;
}
function resolveDependencies(keys, itemIds) {
    return keys.map((dep) => {
        const resolved = itemIds.get(dep);
        if (!resolved)
            throw new SdlcError('invalid_tickets', { key: 'error.dependency_x_is_not_earlier_in_build_order', params: { dep } });
        return resolved;
    });
}
function importBacklog(root, input, plan) {
    const existing = readBacklog(root);
    const epicIds = new Map();
    const itemIds = new Map();
    const epics = [];
    const items = [];
    const skipped = [];
    for (const epic of plan.epics) {
        const source = importedEpicSource(root, input, epic.key);
        const previous = existing.epics.find((entry) => entry.source === source);
        const result = previous ?? addEpic(root, { ...epic, source });
        epicIds.set(epic.key, result.id);
        if (previous)
            skipped.push({ type: 'epic', key: epic.key, id: result.id, title: result.title });
        else
            epics.push(result);
    }
    for (const item of plan.items) {
        const previous = existing.items.find((entry) => item.source && entry.source === item.source);
        if (previous) {
            itemIds.set(item.key, previous.id);
            skipped.push({ type: 'item', key: item.key, id: previous.id, title: previous.title });
            continue;
        }
        const { key, epicKey, dependsOnKeys, ...fields } = item;
        const dependsOn = resolveDependencies(dependsOnKeys, itemIds);
        const created = addBacklogItem(root, { ...fields, epic: epicKey ? epicIds.get(epicKey) : undefined,
            dependsOn });
        itemIds.set(key, created.id);
        items.push(created);
    }
    return { epics, items, skipped };
}
export function importBmadCommand(input, opts) {
    try {
        if (!!opts.change === !!opts.toBacklog) {
            throw new SdlcError('invalid_option', { key: 'error.supply_exactly_one_of_change_or_to_backlog' });
        }
        if (opts.toBacklog) {
            const ctx = loadProject();
            const plan = planBmadBacklog(ctx.root, input);
            if (opts.dryRun) {
                if (opts.json)
                    printJson(plan);
                else
                    printBacklogPreview(plan);
                return;
            }
            const { epics, items, skipped } = importBacklog(ctx.root, input, plan);
            if (epics.length || items.length) {
                appendLog(ctx.root, ctx.config, {
                    event: 'backlog.imported',
                    by: formatIdentity(gitIdentity(ctx.root)),
                    detail: `${epics.length} epics, ${items.length} items`,
                }, ctx.stamp);
            }
            if (opts.json)
                printJson({ epics, items, unmapped: plan.unmapped, warnings: plan.warnings, skipped });
            else {
                line(t('import.backlogDone', { epics: epics.length, items: items.length }));
                for (const entry of skipped)
                    line(t('import.alreadyImported', { title: entry.title }));
            }
            return;
        }
        const changeId = opts.change;
        assertValidChangeId(changeId);
        const ctx = loadProject();
        const target = path.join(ctx.paths.changesDir, changeId);
        if (fs.existsSync(target))
            throw new SdlcError('change_exists', { key: 'error.change_x_already_exists', params: { opts_change: opts.change ?? '' } });
        const plan = planBmadImport(ctx.root, input, changeId);
        if (opts.dryRun) {
            if (opts.json)
                printJson(plan);
            else
                printChangePreview(plan);
            return;
        }
        const { dir } = createChange(changeId, { kind: opts.kind, risk: opts.risk, sourceType: 'bmad', sourceRef: input });
        for (const file of plan.files) {
            const dest = path.resolve(dir, file.path);
            if (!isWithin(dir, dest))
                throw new SdlcError('invalid_path', { key: 'error.import_path_escapes_change_folder' });
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, file.content, 'utf8');
        }
        const sourceDir = path.join(dir, 'sources', 'bmad');
        fs.mkdirSync(sourceDir, { recursive: true });
        for (const doc of plan.docs) {
            const source = path.resolve(ctx.root, doc.path);
            const dest = path.resolve(sourceDir, path.basename(doc.path));
            if (!isWithin(sourceDir, dest) || fs.lstatSync(source).isSymbolicLink())
                throw new SdlcError('invalid_path', { key: 'error.invalid_bmad_source' });
            fs.copyFileSync(source, dest);
        }
        const by = formatIdentity(gitIdentity(ctx.root));
        for (const item of plan.deferred)
            addDeferred(ctx.root, { ...item, change: changeId, by });
        recordChangeEvent(ctx, { id: changeId, dir }, readChangeState(dir), 'change.imported', by, input);
        const next = resolveNext(ctx, changeId);
        if (opts.json)
            printJson({ ...plan, ...(next ? { next } : {}) });
        else {
            line(t('import.changeDone', { change: changeId }));
            emitNextHint(ctx, changeId);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
