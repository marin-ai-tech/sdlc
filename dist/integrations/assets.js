import * as path from 'node:path';
import { parse } from 'yaml';
import { SdlcError } from '../core/errors.js';
import { readText } from '../core/fs-utils.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
/** Workflow ids in the order they are presented to people. */
export const WORKFLOW_IDS = [
    'help',
    'guide',
    'next',
    'status',
    'health',
    'adopt',
    'team',
    'backlog',
    'explore',
    'intent',
    'spec',
    'plan',
    'build',
    'verify',
    'review',
    'release',
    'archive',
    'triage',
];
export const AGENT_IDS = ['verifier', 'reviewer', 'researcher', 'simplifier', 'health', 'advocate'];
export function assetsDir() {
    return path.join(harnessPackageDir(), 'assets');
}
export function readAsset(...segments) {
    const file = path.join(assetsDir(), ...segments);
    const text = readText(file);
    if (text === undefined) {
        throw new SdlcError('missing_asset', { key: 'error.harness_asset_not_found_x', params: { file: file } }, { key: 'fix.reinstall_the_harness_package' });
    }
    return text.replace(/\r\n?/g, '\n');
}
export function splitFrontmatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match)
        return { data: {}, body: text };
    const data = parse(match[1]);
    return { data: data ?? {}, body: match[2].replace(/^\n+/, '') };
}
export function loadWorkflow(id) {
    const { data, body } = splitFrontmatter(readAsset('workflows', `${id}.md`));
    const str = (key) => (typeof data[key] === 'string' ? data[key] : undefined);
    const description = str('description');
    if (!description)
        throw new SdlcError('invalid_asset', { key: 'error.workflow_x_has_no_description', params: { id: id } });
    return {
        id,
        title: str('title') ?? `SDLC: ${id}`,
        description,
        commandDescription: str('command-description') ?? description,
        ...(str('argument-hint') ? { argumentHint: str('argument-hint') } : {}),
        ...(str('when-to-use') ? { whenToUse: str('when-to-use') } : {}),
        body,
    };
}
export function loadAgent(id) {
    const { data, body } = splitFrontmatter(readAsset('agents', `${id}.md`));
    const name = typeof data.name === 'string' ? data.name : `sdlc-${id}`;
    return {
        id,
        name,
        description: String(data.description ?? ''),
        tools: Array.isArray(data.tools) ? data.tools.map(String) : ['read', 'grep', 'glob'],
        readonly: data.readonly !== false,
        body,
    };
}
