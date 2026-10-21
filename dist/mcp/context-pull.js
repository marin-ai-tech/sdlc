import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { CONTEXT_DIR, MAX_SOURCE_BYTES } from '../core/context-packs.js';
import { SdlcError } from '../core/errors.js';
import { isDirectory, isWithin, writeTextAtomic } from '../core/fs-utils.js';
import { maskSecrets } from './checks.js';
import { withServer } from './client.js';
import { assertNoSecretLiterals, expandedSecrets } from './registry.js';
/**
 * `sdlc context pull` (B101): reads each `context.sources` entry from its knowledge server and writes it as the
 * pack `docs/context/<name>.md` — the header sdlc builds (owner, `source: mcp:<server> <resource or tool>`,
 * `updated` today, `fresh_days`, `stages`), then the server's text as the body. The text is untrusted and only
 * ever lands in the body: the header is written first, by position, so a `---` in the body can never join it.
 * A source that fails keeps its old file: the file is assembled first and renamed into place on success only
 * (`writeTextAtomic`), and the target is checked with `isWithin` so nothing lands outside `docs/context/`.
 * What a server was given (expanded `env`/`headers`) is masked in a failure reason, as in the verify checks.
 */
export const PULL_TIMEOUT_MS = 60_000;
/** `fresh_days` written when a source does not declare one: a month — the pack warns early rather than never. */
export const DEFAULT_FRESH_DAYS = 30;
/** The text of every `contents` entry that carries text; a blob entry cannot go into a markdown pack. */
function resourceText(contents) {
    const parts = contents.filter((item) => typeof item.text === 'string').map((item) => item.text);
    return parts.length > 0 ? parts.join('\n') : undefined;
}
/** The text parts of a tools/call answer, in order; `undefined` when it carries no text. */
function toolText(answer) {
    const content = Array.isArray(answer.content) ? answer.content : [];
    const parts = content
        .filter((part) => part && typeof part === 'object'
        && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text);
    return parts.length > 0 ? parts.join('\n') : undefined;
}
/** A resource's text contents. */
async function resourceBody(client, uri, ms) {
    const answer = await client.readResource({ uri }, { timeout: ms });
    const text = resourceText(answer.contents);
    if (text === undefined)
        throw new Error('the resource carried no text');
    return text;
}
/** The text parts of a tool call; `isError` fails the source with the server's own text. */
async function toolBody(client, tool, args, ms) {
    const answer = (await client.callTool({ name: tool, arguments: args }, undefined, { timeout: ms }));
    if (answer.isError === true)
        throw new Error(toolText(answer) ?? 'tool reported an error');
    const text = toolText(answer);
    if (text === undefined)
        throw new Error('the answer carried no text');
    return text;
}
/** The body text one source serves; the whole session fits in `ms`. */
async function fetchText(server, spec, ms) {
    return withServer(server, ms, async (client) => {
        if (spec.resource !== undefined)
            return resourceBody(client, spec.resource, ms);
        if (spec.tool !== undefined)
            return toolBody(client, spec.tool, spec.args, ms);
        throw new Error('the source names no resource and no tool');
    });
}
/** The pack's text: the header first (by position, so no body line can enter it), then the body. */
function packText(spec, body, updated) {
    const header = stringify({
        owner: spec.owner,
        source: `mcp:${spec.server} ${spec.resource ?? spec.tool}`,
        updated,
        fresh_days: spec.freshDays ?? DEFAULT_FRESH_DAYS,
        stages: spec.stages,
    }).trimEnd();
    const text = `---\n${header}\n---\n\n${body}`;
    return text.endsWith('\n') ? text : `${text}\n`;
}
/**
 * The file `name` writes to, checked to stay inside the context dir: `name` cannot escape lexically (its
 * characters), and a `docs/context` that is a link out of the project is refused as well.
 */
function packTarget(root, name) {
    const dir = path.join(root, CONTEXT_DIR);
    const target = path.join(dir, `${name}.md`);
    const realDir = isDirectory(dir) ? fs.realpathSync(dir) : dir;
    const realTarget = path.join(realDir, `${name}.md`);
    const inside = isWithin(fs.realpathSync(root), realTarget) && isWithin(realDir, realTarget);
    if (!inside) {
        throw new SdlcError('unsafe_path', { key: 'error.x_must_stay_inside_the_project', params: { p1: `${CONTEXT_DIR}/${name}.md` } });
    }
    return target;
}
/** One source: fetch, assemble, check the size, then write; throws the failure reason on any error. */
async function pullSource(root, server, spec) {
    const body = await fetchText(server, spec, PULL_TIMEOUT_MS);
    const text = packText(spec, body, new Date().toISOString().slice(0, 10));
    if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES)
        throw new Error('too large');
    writeTextAtomic(packTarget(root, spec.name), text);
    return `${CONTEXT_DIR}/${spec.name}.md`;
}
function failureReason(error, server, env) {
    const text = error instanceof Error ? error.message : String(error);
    return maskSecrets(text, expandedSecrets(server, env));
}
/**
 * Pulls every configured source — or only `only` — one at a time. `assertNoSecretLiterals` applies as in
 * `sdlc mcp check`; a source whose server is unreachable, errors or answers nothing is named in `failed` and its
 * file is left as it was. Entries the config parser could not read (`context.invalid`) are failed before any
 * fetch, with their reason — and nothing is written for them. An `only` no source has is a usage error.
 */
export async function pullContextSources(root, config, only, env = process.env) {
    const servers = config.mcp?.servers ?? [];
    assertNoSecretLiterals(servers);
    const configured = config.context?.sources ?? [];
    const sources = only === undefined ? configured : configured.filter((spec) => spec.name === only);
    const invalid = (config.context?.invalid ?? []).filter((item) => only === undefined || item.name === only);
    if (only !== undefined && sources.length === 0 && invalid.length === 0) {
        throw new SdlcError('unknown_context_source', { key: 'error.unknown_context_source_x', params: { name: only } });
    }
    const result = { pulled: [], failed: [...invalid] };
    for (const spec of sources) {
        const server = servers.find((item) => item.name === spec.server);
        if (server === undefined) {
            result.failed.push({ name: spec.name, reason: 'server not in mcp.servers' });
            continue;
        }
        try {
            const file = await pullSource(root, server, spec);
            result.pulled.push({ name: spec.name, file });
        }
        catch (error) {
            result.failed.push({ name: spec.name, reason: failureReason(error, server, env) });
        }
    }
    return result;
}
