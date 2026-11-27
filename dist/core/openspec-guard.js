import * as path from 'node:path';
import { t } from './i18n.js';
import { isFile } from './fs-utils.js';
/** Process decisions for writes to OpenSpec's living tree and uncreated changes. */
export function openspecWrite(rels, paths) {
    const specs = path.relative(paths.root, paths.specsDir).replace(/\\/g, '/');
    const changes = path.relative(paths.root, paths.changesDir).replace(/\\/g, '/');
    for (const rel of rels) {
        if (rel.toLowerCase().startsWith(`${specs.toLowerCase()}/`)) {
            return { rule: 'living-specs', reason: t('hook.livingSpecs') };
        }
        const prefix = `${changes.toLowerCase()}/`;
        if (!rel.toLowerCase().startsWith(prefix))
            continue;
        const id = rel.slice(prefix.length).split('/')[0];
        if (!id || id.toLowerCase() === 'archive')
            continue;
        const dir = path.join(paths.changesDir, id);
        if (isFile(path.join(dir, '.sdlc.yaml')))
            continue;
        if (isFile(path.join(dir, '.openspec.yaml')))
            continue;
        return { rule: 'change-not-created', reason: t('hook.changeNotCreated', { id }) };
    }
    return undefined;
}
/** OpenSpec's standalone creator omits the lifecycle metadata required by sdlc new. */
export function openspecNewChange(command) {
    const match = /\b(?:sdlc\s+)?openspec\s+new\s+change\s+([\w-]+)/i.exec(command);
    if (!match)
        return undefined;
    return { rule: 'change-not-created', reason: t('hook.changeNotCreated', { id: match[1] }) };
}
