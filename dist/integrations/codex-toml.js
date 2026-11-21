import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
/**
 * Codex's `.codex/config.toml` (B82, 0.14.0): sdlc owns only the `[mcp_servers.<name>]` tables it wrote (with their
 * sub-tables, `[mcp_servers.<name>.env]` and the like). A minimal, section-level merge, no TOML parser: the file is
 * split at its table headers, every other table, key and comment of the person's own stays byte for byte, and a
 * table of sdlc's is replaced (or removed) as a whole. Servers defined inline (`mcp_servers = { … }`, dotted keys
 * under `[mcp_servers]`) are not seen: sdlc then adds its own table, as for a file without them.
 */
export const CODEX_CONFIG_PATH = '.codex/config.toml';
/** `[a.b]` or `[[a.b]]`, with an optional comment after it. */
const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
/** The parts of a dotted key, quotes removed: `mcp_servers."a b".env` -> [mcp_servers, a b, env]. */
export function keyParts(key) {
    const parts = [];
    for (const match of key.matchAll(/\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.|$)/g)) {
        parts.push(match[1] ?? match[2] ?? match[3]);
    }
    return parts;
}
/**
 * The multi-line string (`"""` or `'''`) still open after a line, given the one open before it (B84): lines inside
 * such a string are never table headers.
 */
function openString(line, open) {
    let current = open;
    let at = 0;
    while (at < line.length) {
        const next = nextDelimiter(line, at, current);
        if (next === undefined)
            return current;
        current = current === undefined ? next.delimiter : undefined;
        at = next.index + 3;
    }
    return current;
}
function nextDelimiter(line, from, open) {
    const candidates = open === undefined ? ['"""', "'''"] : [open];
    const found = candidates
        .map((delimiter) => ({ delimiter, index: line.indexOf(delimiter, from) }))
        .filter((hit) => hit.index >= 0)
        .sort((a, b) => a.index - b.index);
    return found[0];
}
function blocks(text) {
    const out = [{ key: undefined, lines: [] }];
    let open;
    for (const line of text.split(/\r?\n/)) {
        const header = open === undefined ? HEADER.exec(line) : null;
        open = openString(line, open);
        if (header) {
            const previous = out[out.length - 1];
            const trailing = [];
            if (serverOf(previous) === 'sdlc') {
                while (previous.lines.length > 0 && /^\s*(?:#.*)?$/.test(previous.lines[previous.lines.length - 1])) {
                    trailing.unshift(previous.lines.pop());
                }
            }
            out.push({ key: header[1], lines: [...trailing, line] });
        }
        else
            out[out.length - 1].lines.push(line);
    }
    return out;
}
/** The server a block belongs to (`mcp_servers.<name>` or one of its sub-tables), if any. */
function serverOf(block) {
    if (block.key === undefined)
        return undefined;
    const parts = keyParts(block.key);
    return parts[0] === 'mcp_servers' && parts.length >= 2 ? parts[1] : undefined;
}
/** Lines without the blank lines at their end, so two spellings of the same table compare equal. */
function trimmed(lines) {
    const copy = [...lines];
    while (copy.length > 0 && copy[copy.length - 1].trim() === '')
        copy.pop();
    return copy;
}
/** The `[mcp_servers.<name>]` tables of a TOML text, by server name. */
export function mcpTables(text) {
    const grouped = {};
    for (const block of blocks(text)) {
        const name = serverOf(block);
        if (name !== undefined)
            grouped[name] = [...(grouped[name] ?? []), ...trimmed(block.lines)];
    }
    return Object.fromEntries(Object.entries(grouped).map(([name, lines]) => [name, trimmed(lines).join('\n')]));
}
/**
 * The text with each named server set to its table text (`undefined` removes it). A server already in the file is
 * replaced where it stood; a new one is appended at the end.
 */
export function setMcpTables(text, tables) {
    const done = new Set();
    const out = [];
    for (const block of blocks(text)) {
        const name = serverOf(block);
        if (name === undefined || !(name in tables)) {
            out.push(...block.lines);
            continue;
        }
        if (done.has(name))
            continue;
        done.add(name);
        const table = tables[name];
        if (table !== undefined)
            out.push(table, '');
        const comments = block.lines.filter((line) => /^\s*#/.test(line));
        if (comments.length > 0) {
            out.push(...comments);
        }
    }
    const added = Object.entries(tables).filter(([name, table]) => !done.has(name) && table !== undefined);
    const body = trimmed(out);
    for (const [, table] of added)
        body.push(...(body.length > 0 ? [''] : []), table);
    return body.length === 0 ? '' : `${body.join('\n')}\n`;
}
/** A TOML basic string (JSON's escapes are TOML's). */
function str(value) {
    return JSON.stringify(value).replace(/\u007f/g, '\\u007F');
}
/** A table key: bare when it can be, else quoted. */
function key(name) {
    return BARE_KEY.test(name) ? name : str(name);
}
function array(values) {
    return `[${values.map(str).join(', ')}]`;
}
function subTable(name, sub, map) {
    const entries = Object.entries(map);
    if (entries.length === 0)
        return [];
    return ['', `[mcp_servers.${key(name)}.${sub}]`, ...entries.map(([k, v]) => `${key(k)} = ${str(v)}`)];
}
/** The `sdlc mcp serve` server: `command` and `args`. */
export function sdlcServerTable(command, args) {
    return ['[mcp_servers.sdlc]', `command = ${str(command)}`, `args = ${array(args)}`].join('\n');
}
const WHOLE_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const BEARER_REF = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
/** Stdio env: `KEY = "${KEY}"` is forwarded from Codex's environment (`env_vars`); other values are written as is. */
function stdioTable(server) {
    const [command, ...args] = server.command;
    const forwarded = Object.entries(server.env).filter(([k, v]) => WHOLE_REF.exec(v)?.[1] === k).map(([k]) => k);
    const literal = Object.fromEntries(Object.entries(server.env).filter(([k]) => !forwarded.includes(k)));
    const head = [`command = ${str(command)}`, `args = ${array(args)}`];
    if (forwarded.length > 0)
        head.push(`env_vars = ${array(forwarded)}`);
    return [...head, ...subTable(server.name, 'env', literal)];
}
/** Http headers: `Bearer ${VAR}` -> `bearer_token_env_var`, `${VAR}` -> `env_http_headers`, else `http_headers`. */
function httpTable(server) {
    const head = [`url = ${str(server.url)}`];
    const fromEnv = {};
    const literal = {};
    for (const [header, value] of Object.entries(server.headers)) {
        const bearer = /^authorization$/i.test(header) ? BEARER_REF.exec(value) : null;
        const whole = WHOLE_REF.exec(value);
        if (bearer)
            head.push(`bearer_token_env_var = ${str(bearer[1])}`);
        else if (whole)
            fromEnv[header] = whole[1];
        else
            literal[header] = value;
    }
    const env = subTable(server.name, 'env_http_headers', fromEnv);
    return [...head, ...env, ...subTable(server.name, 'http_headers', literal)];
}
/** A registry server (B10) as Codex's table. */
export function registryServerTable(server) {
    const body = server.type === 'http' ? httpTable(server) : stdioTable(server);
    return [`[mcp_servers.${key(server.name)}]`, ...body].join('\n');
}
/** The sdlc server table this harness wrote: it runs sdlc and ends with `mcp serve`. */
export function isOurSdlcTable(table) {
    return table !== undefined && /"mcp",\s*"serve"\s*\]/.test(table) && /sdlc/.test(table);
}
export function readConfigToml(root) {
    return readText(path.join(root, CODEX_CONFIG_PATH));
}
/** Writes the text, or removes the file when nothing but blank lines is left. */
export function writeConfigToml(root, text) {
    const abs = path.join(root, CODEX_CONFIG_PATH);
    if (text.trim() === '')
        fs.rmSync(abs, { force: true });
    else
        writeTextAtomic(abs, text);
}
