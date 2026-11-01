/**
 * Subset TOML parser for BMAD `tickets.toml` files.
 * Supported: comments, `[[table]]` arrays, `key = value` with basic strings
 * (\" \\ \n), integers, booleans, arrays of those, and inline tables inside arrays.
 */
import { SdlcError } from './errors.js';
function err(file, line, detail) {
    throw new SdlcError('invalid_tickets', { key: 'error.x_x_x', params: { file: file, line: line, detail: detail } });
}
class Parser {
    lines;
    i = 0;
    file;
    constructor(text, file) {
        this.lines = text.replace(/\r\n?/g, '\n').split('\n');
        this.file = file;
    }
    parse() {
        const tables = {};
        let current;
        while (this.i < this.lines.length) {
            const lineNo = this.i + 1;
            const raw = this.lines[this.i];
            this.i++;
            const trimmed = stripComment(raw).trim();
            if (!trimmed)
                continue;
            const arrayHeader = trimmed.match(/^\[\[([A-Za-z_][A-Za-z0-9_-]*)\]\]$/);
            if (arrayHeader) {
                const name = arrayHeader[1];
                current = {};
                (tables[name] ??= []).push(current);
                continue;
            }
            if (/^\[[^\]]+\]$/.test(trimmed)) {
                err(this.file, lineNo, 'unsupported table header (only [[table]] arrays are allowed)');
            }
            const eq = trimmed.indexOf('=');
            if (eq <= 0)
                err(this.file, lineNo, 'expected key = value');
            const key = trimmed.slice(0, eq).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
                err(this.file, lineNo, `invalid key "${key}"`);
            if (!current)
                err(this.file, lineNo, 'key outside of a [[table]]');
            const valueText = trimmed.slice(eq + 1).trim();
            current[key] = this.parseValue(valueText, lineNo);
        }
        return tables;
    }
    parseValue(text, lineNo) {
        if (text === '')
            err(this.file, lineNo, 'missing value');
        if (text === 'true')
            return true;
        if (text === 'false')
            return false;
        if (/^-?\d+$/.test(text))
            return Number(text);
        if (text.startsWith('"'))
            return this.parseString(text, lineNo);
        if (text.startsWith('['))
            return this.parseArray(text, lineNo);
        if (text.startsWith('{'))
            return this.parseInlineTable(text, lineNo);
        err(this.file, lineNo, `unsupported value: ${text}`);
    }
    parseString(text, lineNo) {
        if (!text.startsWith('"'))
            err(this.file, lineNo, 'expected string');
        let out = '';
        let i = 1;
        while (i < text.length) {
            const ch = text[i];
            if (ch === '"') {
                if (text.slice(i + 1).trim() !== '')
                    err(this.file, lineNo, 'trailing junk after string');
                return out;
            }
            if (ch === '\\') {
                const next = text[i + 1];
                if (next === '"' || next === '\\') {
                    out += next;
                    i += 2;
                    continue;
                }
                if (next === 'n') {
                    out += '\n';
                    i += 2;
                    continue;
                }
                err(this.file, lineNo, `unsupported escape \\${next ?? ''}`);
            }
            out += ch;
            i++;
        }
        err(this.file, lineNo, 'unterminated string');
    }
    parseArray(text, lineNo) {
        if (!text.startsWith('[') || !text.endsWith(']'))
            err(this.file, lineNo, 'unterminated array');
        const inner = text.slice(1, -1).trim();
        if (!inner)
            return [];
        const parts = splitTopLevel(inner, ',');
        return parts.map((part) => this.parseValue(part.trim(), lineNo));
    }
    parseInlineTable(text, lineNo) {
        if (!text.startsWith('{') || !text.endsWith('}'))
            err(this.file, lineNo, 'unterminated inline table');
        const inner = text.slice(1, -1).trim();
        const obj = {};
        if (!inner)
            return obj;
        for (const part of splitTopLevel(inner, ',')) {
            const eq = part.indexOf('=');
            if (eq <= 0)
                err(this.file, lineNo, 'invalid inline table entry');
            const key = part.slice(0, eq).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
                err(this.file, lineNo, `invalid key "${key}"`);
            obj[key] = this.parseValue(part.slice(eq + 1).trim(), lineNo);
        }
        return obj;
    }
}
/** Strip a `#` comment that is not inside a double-quoted string. */
function stripComment(line) {
    let inString = false;
    let escape = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (ch === '\\')
                escape = true;
            else if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '#')
            return line.slice(0, i);
    }
    return line;
}
/** Split on delimiter at brace/bracket/string depth 0. */
function splitTopLevel(text, delimiter) {
    const parts = [];
    let start = 0;
    let depthBracket = 0;
    let depthBrace = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (ch === '\\')
                escape = true;
            else if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '[')
            depthBracket++;
        else if (ch === ']')
            depthBracket--;
        else if (ch === '{')
            depthBrace++;
        else if (ch === '}')
            depthBrace--;
        else if (ch === delimiter && depthBracket === 0 && depthBrace === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}
/** `[[name]]` table arrays by name, in file order. */
export function parseTicketsToml(text, file = 'tickets.toml') {
    return new Parser(text, file).parse();
}
