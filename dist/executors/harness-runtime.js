import { SdlcError } from '../core/errors.js';
import { recordObject } from '../core/record-values.js';
function identifier(value) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value))
        fail('identifier');
    return value;
}
function fail(detail) {
    throw new SdlcError('harness_protocol', { key: 'error.harnessProtocol', params: { detail } });
}
async function responseJson(response) {
    const reader = response.body?.getReader();
    if (!reader)
        fail('invalid response');
    const chunks = [];
    let bytes = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            bytes += chunk.value.byteLength;
            if (bytes > 2 * 1024 * 1024)
                fail('response too large');
            chunks.push(chunk.value);
        }
        return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, bytes)));
    }
    catch {
        void reader.cancel().catch(() => { });
        fail('invalid response');
    }
    finally {
        reader.releaseLock();
    }
}
function sessionOf(value) {
    const raw = recordObject(value);
    if (!raw || typeof raw.session_id !== 'string' || typeof raw.status !== 'string')
        fail('session response');
    return { id: identifier(raw.session_id), status: raw.status };
}
/** DigitalOcean's documented /v2/agents API. Tokens stay on the host and are never request-body fields. */
export class HarnessRuntime {
    #token;
    #fetch;
    constructor(token, fetcher = fetch) {
        if (!token || /[\r\n]/.test(token))
            fail('host token');
        this.#token = token;
        this.#fetch = fetcher;
    }
    async request(route, method = 'GET', body) {
        let response;
        try {
            response = await this.#fetch(`https://api.digitalocean.com/v2/agents/${route}`, {
                method, headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(30000), redirect: 'error',
            });
        }
        catch {
            fail('transport failed');
        }
        if (!response.ok) {
            void response.body?.cancel().catch(() => { });
            fail(`HTTP ${response.status}`);
        }
        if (response.status === 204)
            return {};
        return responseJson(response);
    }
    async create(configId, name) {
        return sessionOf(await this.request('sessions', 'POST', { config_id: identifier(configId), name: identifier(name) }));
    }
    async get(id) {
        return sessionOf(await this.request(`sessions/${identifier(id)}`));
    }
    async fork(id, count, checkpoint) {
        if (!Number.isInteger(count) || count < 1 || count > 4)
            fail('fork count');
        const raw = recordObject(await this.request(`sessions/${identifier(id)}/fork`, 'POST', {
            count, ...(checkpoint ? { from_checkpoint_id: identifier(checkpoint) } : {}),
        }));
        if (!Array.isArray(raw?.sessions) || raw.sessions.length !== count)
            fail('fork response');
        return raw.sessions.map(sessionOf);
    }
    async input(id, text) {
        if (!text.trim())
            fail('empty task');
        await this.request(`sessions/${identifier(id)}/input`, 'POST', { text });
    }
    async exec(id, argv, stdin = '', workdir = '/workspace') {
        if (!argv.length || argv.some((arg) => typeof arg !== 'string'))
            fail('argv');
        const raw = recordObject(await this.request(`sessions/${identifier(id)}/sandbox/exec`, 'POST', {
            argv, stdin, workdir, timeout_seconds: 60,
        }));
        if (!raw || !Number.isInteger(raw.exit_code)
            || (raw.stdout !== undefined && typeof raw.stdout !== 'string')
            || (raw.stderr !== undefined && typeof raw.stderr !== 'string'))
            fail('exec response');
        return { exitCode: raw.exit_code,
            stdout: raw.stdout === undefined ? '' : raw.stdout,
            stderr: raw.stderr === undefined ? '' : raw.stderr };
    }
    async pause(id) {
        await this.request(`sessions/${identifier(id)}/pause`, 'POST', {});
    }
    async resume(id) {
        await this.request(`sessions/${identifier(id)}/resume`, 'POST', {});
    }
}
