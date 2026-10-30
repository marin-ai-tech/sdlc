import { LIMITS, fail } from './api.js';
const numeric = new Set([0x7f, 0x7e, 0x7d, 0x7c]);
class Reader {
    bytes;
    at = 0;
    constructor(bytes) {
        this.bytes = bytes;
    }
    byte() {
        if (this.at >= this.bytes.length)
            fail('plugin_wasm', 'Truncated Wasm binary');
        return this.bytes[this.at++];
    }
    uint() {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.byte();
            if (i === 4 && (byte & 0xf0))
                fail('plugin_wasm', 'Overflowing Wasm length');
            value += (byte & 127) * 2 ** (7 * i);
            if (!(byte & 128))
                return value;
        }
        return fail('plugin_wasm', 'Unbounded Wasm length');
    }
    count(max) {
        const n = this.uint();
        if (n > max)
            fail('plugin_wasm', 'Wasm resource count exceeds profile');
        return n;
    }
    take(size) {
        if (size > this.bytes.length - this.at)
            fail('plugin_wasm', 'Invalid Wasm section length');
        const out = this.bytes.subarray(this.at, this.at + size);
        this.at += size;
        return out;
    }
    name() { return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.count(1024))); }
    type() {
        const type = this.byte();
        if (!numeric.has(type))
            fail('plugin_wasm', 'Only numeric Wasm values are supported');
        return type;
    }
    vector(max) { return Array.from({ length: this.count(max) }, () => this.type()); }
    end() {
        if (this.at !== this.bytes.length)
            fail('plugin_wasm', 'Unconsumed Wasm section bytes');
    }
}
function limits(r, memory) {
    if (r.byte() !== 1)
        fail('plugin_wasm', 'Wasm limits require an unshared wasm32 maximum');
    const min = r.uint();
    const max = r.uint();
    if (memory ? min !== LIMITS.initialPages || max !== LIMITS.pages : min > max || max > 4096) {
        fail('plugin_wasm', 'Wasm memory/table limit is outside the profile');
    }
}
function expression(r) {
    const op = r.byte();
    if (op === 0x41 || op === 0x42) {
        let ended = false;
        for (let i = 0; i < (op === 0x41 ? 5 : 10); i++) {
            if (!(r.byte() & 128)) {
                ended = true;
                break;
            }
        }
        if (!ended)
            fail('plugin_wasm', 'Unbounded Wasm constant');
    }
    else if (op === 0x43 || op === 0x44)
        r.take(op === 0x43 ? 4 : 8);
    else if (op === 0x23)
        r.uint();
    else
        fail('plugin_wasm', 'Unsupported Wasm initializer');
    if (r.byte() !== 0x0b)
        fail('plugin_wasm', 'Unsupported Wasm initializer expression');
}
function elements(r) {
    let total = 0;
    for (let i = 0, n = r.count(4096); i < n; i++) {
        const mode = r.uint();
        if (mode > 3)
            fail('plugin_wasm', 'Unsupported Wasm element form');
        if (mode === 2 && r.uint() !== 0)
            fail('plugin_wasm', 'Invalid table index');
        if (mode === 0 || mode === 2)
            expression(r);
        if (mode !== 0 && r.byte() !== 0)
            fail('plugin_wasm', 'Invalid Wasm element type');
        const count = r.count(4096);
        total += count;
        if (total > 4096)
            fail('plugin_wasm', 'Too many Wasm table elements');
        for (let j = 0; j < count; j++)
            r.uint();
    }
}
function data(r) {
    for (let i = 0, n = r.count(4096); i < n; i++) {
        const mode = r.uint();
        if (mode > 2)
            fail('plugin_wasm', 'Unsupported Wasm data form');
        if (mode === 2 && r.uint() !== 0)
            fail('plugin_wasm', 'Invalid memory index');
        if (mode !== 1)
            expression(r);
        r.take(r.count(LIMITS.moduleBytes));
    }
}
export function validateProfile(bytes) {
    if (bytes.length > LIMITS.moduleBytes)
        fail('plugin_limit', 'Wasm module byte limit exceeded');
    const r = new Reader(bytes);
    if (Buffer.from(r.take(8)).toString('hex') !== '0061736d01000000')
        fail('plugin_wasm', 'Invalid Wasm header');
    const types = [];
    const functions = [];
    const globals = [];
    const exports = new Map();
    const seen = new Set();
    let custom = 0;
    let importedMemory = false;
    let codeCount = -1;
    let locals = 0;
    while (r.at < bytes.length) {
        const id = r.byte();
        const s = new Reader(r.take(r.count(LIMITS.moduleBytes)));
        if (id === 0) {
            if (++custom > 64)
                fail('plugin_wasm', 'Too many Wasm custom sections');
            continue;
        }
        if (seen.has(id) || id === 8 || id > 12)
            fail('plugin_wasm', 'Unsupported/duplicate Wasm section or start');
        seen.add(id);
        if (id === 1) {
            for (let i = 0, n = s.count(4096); i < n; i++) {
                if (s.byte() !== 0x60)
                    fail('plugin_wasm', 'Unsupported Wasm function type');
                types.push({ input: s.vector(64), output: s.vector(1) });
            }
        }
        else if (id === 2) {
            if (s.count(1) !== 1 || s.name() !== 'sdlc' || s.name() !== 'memory' || s.byte() !== 2) {
                fail('plugin_wasm', 'The only Wasm import is sdlc.memory');
            }
            limits(s, true);
            importedMemory = true;
        }
        else if (id === 3) {
            for (let i = 0, n = s.count(4096); i < n; i++)
                functions.push(s.uint());
        }
        else if (id === 4) {
            for (let i = 0, n = s.count(1); i < n; i++) {
                if (s.byte() !== 0x70)
                    fail('plugin_wasm', 'Only a bounded funcref table is supported');
                limits(s, false);
            }
        }
        else if (id === 5) {
            if (s.uint() !== 0)
                fail('plugin_wasm', 'Defined or additional Wasm memory is refused');
        }
        else if (id === 6) {
            for (let i = 0, n = s.count(1024); i < n; i++) {
                const type = s.type();
                const mutable = s.byte();
                if (mutable > 1)
                    fail('plugin_wasm', 'Invalid global mutability');
                globals.push({ type, mutable: mutable === 1 });
                expression(s);
            }
        }
        else if (id === 7) {
            for (let i = 0, n = s.count(1027); i < n; i++) {
                const name = s.name();
                if (exports.has(name))
                    fail('plugin_wasm', 'Duplicate export');
                exports.set(name, { kind: s.byte(), index: s.uint() });
            }
        }
        else if (id === 9)
            elements(s);
        else if (id === 10) {
            codeCount = s.count(4096);
            for (let i = 0; i < codeCount; i++) {
                const body = new Reader(s.take(s.count(LIMITS.moduleBytes)));
                let count = 0;
                for (let j = 0, n = body.count(4096); j < n; j++) {
                    count += body.count(4096);
                    body.type();
                }
                locals += count;
                if (count > 4096 || locals > 65536)
                    fail('plugin_wasm', 'Too many Wasm locals');
            }
        }
        else if (id === 11)
            data(s);
        else if (id === 12)
            s.count(4096);
        else
            fail('plugin_wasm', 'Unsupported Wasm section');
        s.end();
    }
    if (!importedMemory || codeCount !== functions.length)
        fail('plugin_wasm', 'Missing memory or function bodies');
    for (const [name, entry] of exports) {
        if (name === 'memory' && entry.kind === 2 && entry.index === 0)
            continue;
        if (['sdlc_alloc', 'sdlc_call'].includes(name) && entry.kind === 0)
            continue;
        if (entry.kind !== 3 || !globals[entry.index] || globals[entry.index].mutable) {
            fail('plugin_wasm', 'Unexpected Wasm export');
        }
    }
    for (const [name, input, output] of [['sdlc_alloc', [0x7f], [0x7f]], ['sdlc_call', [0x7f, 0x7f], [0x7e]]]) {
        const exp = exports.get(name);
        const sig = exp?.kind === 0 ? types[functions[exp.index]] : undefined;
        if (!sig || JSON.stringify(sig) !== JSON.stringify({ input, output }))
            fail('plugin_wasm', 'Invalid Wasm ABI');
    }
    if (exports.get('memory')?.kind !== 2)
        fail('plugin_wasm', 'Missing memory export');
}
