import * as path from 'node:path';
import { isValidChangeId } from './changes.js';
import { readChangeState } from './change-state.js';
import { checkDeltaTargets, readChangeDeltas } from './deltas.js';
import { isDirectory, isFile } from './fs-utils.js';
import { t } from './i18n.js';
import { evaluateChange } from './lifecycle.js';
import { openspecFailure, runOpenSpecJson } from './openspec.js';
import { readOpenSpecMetadata } from './openspec-schema.js';
function needsDeltaSpecs(ctx, ref) {
    const state = readChangeState(ref.dir);
    if (state.track !== 'full' || readOpenSpecMetadata(ref.dir).skip_specs === true)
        return false;
    const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true, skipPeople: true });
    const spec = view.gates.find((gate) => gate.id === 'spec');
    if (!spec?.required || spec.status === 'n/a' || spec.status === 'waived')
        return false;
    const intent = view.gates.find((gate) => gate.id === 'intent');
    if (intent?.status === 'approved' || intent?.status === 'waived')
        return true;
    const specArtifacts = ['proposal.md', 'design.md', 'spec.md'];
    return specArtifacts.some((name) => isFile(path.join(ref.dir, name)))
        || isDirectory(path.join(ref.dir, 'specs'));
}
export function validateOne(ctx, ref) {
    const issues = [];
    if (!isValidChangeId(ref.id)) {
        const key = 'validate.invalidChangeFolder';
        issues.push({
            source: 'sdlc', level: 'error', message: t(key, { id: ref.id }, 'en'),
            textKey: key, textParams: { id: ref.id },
        });
        return { change: ref.id, valid: false, issues };
    }
    const deltas = readChangeDeltas(ref.dir);
    const skipSpecs = readOpenSpecMetadata(ref.dir).skip_specs === true;
    if (deltas.length === 0 && !skipSpecs && needsDeltaSpecs(ctx, ref)) {
        issues.push({ source: 'sdlc', level: 'error',
            message: t('validate.noDeltaSpecs', undefined, 'en'), textKey: 'validate.noDeltaSpecs' });
    }
    else if (deltas.length > 0) {
        const result = runOpenSpecJson(['validate', ref.id, '--type', 'change', '--strict', '--no-interactive'], ctx.root);
        const item = result.data?.items?.[0];
        if (!item) {
            issues.push({ source: 'openspec', level: 'error',
                message: `openspec validate failed: ${openspecFailure(result.data, result.raw)}` });
        }
        else {
            for (const issue of item.issues) {
                const level = issue.level.toLowerCase() === 'error' ? 'error'
                    : issue.level.toLowerCase() === 'warning' ? 'warning' : 'info';
                issues.push({ source: 'openspec', level, message: issue.message,
                    ...(issue.path ? { path: issue.path } : {}), ...(issue.line ? { line: issue.line } : {}) });
            }
        }
        issues.push(...checkDeltaTargets(ctx.paths, deltas).map((issue) => ({
            source: 'sdlc', level: issue.level, path: issue.file,
            line: issue.line, message: issue.message,
        })));
    }
    return { change: ref.id, valid: !issues.some((issue) => issue.level === 'error'), issues };
}
