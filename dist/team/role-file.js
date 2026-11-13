import { parse } from 'yaml';
import { normalizeNewlines } from '../core/fs-utils.js';
import { STAGE_IDS } from '../core/stage-config.js';
/** Role ids: lower-case words joined by `-`; also a safe file name. */
export const ROLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DEFAULT_TOOLS = ['read', 'grep', 'glob'];
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
function frontMatter(text) {
    const match = text.match(FRONT_MATTER);
    if (!match)
        return { data: {}, body: text };
    try {
        const data = parse(match[1]);
        const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        return { data: record, body: match[2].replace(/^\n+/, '') };
    }
    catch {
        return { data: {}, body: match[2] };
    }
}
function strings(value) {
    return Array.isArray(value) ? value.map(String) : [];
}
function isStage(value) {
    return STAGE_IDS.includes(value);
}
function text(value, fallback) {
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
function sourceKind(value) {
    const kind = value && typeof value === 'object' ? value.kind : undefined;
    return typeof kind === 'string' ? { sourceKind: kind } : {};
}
/** The role in `text`, named `id` (its file name). */
export function parseRoleFile(id, source) {
    const { data, body } = frontMatter(normalizeNewlines(source).replace(/^\uFEFF/, ''));
    const tools = strings(data.tools);
    return {
        id,
        title: text(data.title, id),
        description: text(data.description, id),
        stages: strings(data.stages).filter(isStage),
        tools: tools.length > 0 ? tools : DEFAULT_TOOLS,
        readonly: data.readonly !== false,
        body,
        skills: strings(data.skills),
        ...sourceKind(data.source),
        ...(typeof data.id === 'string' ? { declaredId: data.id } : {}),
    };
}
