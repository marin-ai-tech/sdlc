import { describe, expect, it, vi } from 'vitest';
import { HarnessRuntime } from '../src/executors/harness-runtime.js';
import { HarnessAdapter, type HarnessHost } from '../src/executors/harness-adapter.js';
import type { TaskItem } from '../src/core/task-contract.js';
import type { Executor } from '../src/core/executors.js';
import { defaultConfig } from '../src/core/config.js';
import { HarnessBundleHost } from '../src/executors/harness-bundle-host.js';

const item: TaskItem = {
  contract: 'sdlc.task/1', id: 'demo#1.1', change: 'demo', kind: 'feature', risk: 'medium', executor: 'hosted',
  task: { id: '1.1', text: 'Add the tested function' }, base: { commit: 'a'.repeat(40) },
  plan: { files: ['src/a.js'], proof: ['node --test'] }, scenarios: ['Named result'],
  checks: [{ name: 'test', run: 'node --test', required: true }], forbidden: ['openspec/**/.sdlc.yaml'],
  result: { branch: 'sdlc/demo/1.1', trailers: {
    'SDLC-Change': 'demo', 'SDLC-Task': '1.1', 'SDLC-Agent': 'hosted/codex',
  } },
};
const executor: Executor = { id: 'hosted', type: 'harness', maxRisk: 'medium', capabilities: [] };

function host(): HarnessHost {
  return { prepare: vi.fn(async () => {}), heartbeat: vi.fn(async () => {}),
    verify: vi.fn(async () => ({ branch: 'candidate', passed: true })) };
}

describe('B124: documented provider wire contract', () => {
  it('retains UTF-8 and BOM decoding for bounded JSON responses', async () => {
    const body = '\uFEFF' + JSON.stringify({ session_id: 'one', status: 'SESSION_STATUS_READY', note: 'caf\u00e9' });
    const runtime = new HarnessRuntime('dummy-host-token', vi.fn(async () => new Response(body)) as never);
    expect(await runtime.get('one')).toEqual({ id: 'one', status: 'SESSION_STATUS_READY' });
  });

  it('stops reading and cancels an oversized response before buffering its entire body', async () => {
    const cancel = vi.fn();
    const chunks = [new Uint8Array(2 * 1024 * 1024).fill(32), Uint8Array.of(32), Uint8Array.of(32)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }, cancel,
    });
    const response = new Response(body);
    const text = vi.spyOn(response, 'text');
    const runtime = new HarnessRuntime('dummy-host-token', vi.fn(async () => response) as never);
    await expect(runtime.get('one')).rejects.toMatchObject({ code: 'harness_protocol' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it('cancels HTTP error bodies without reading or echoing them', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 });
    const text = vi.spyOn(response, 'text');
    const runtime = new HarnessRuntime('dummy-host-token', vi.fn(async () => response) as never);
    await expect(runtime.get('one')).rejects.toMatchObject({ code: 'harness_protocol' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it('uses the fixed HTTPS origin, refuses redirects and sends credentials only as an auth header', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      session_id: 'sess_one', status: 'SESSION_STATUS_READY', token: 'provider-secret',
    })));
    const runtime = new HarnessRuntime('host-only-token', fetcher as never);
    expect(await runtime.create('config-one', 'demo')).toEqual({ id: 'sess_one', status: 'SESSION_STATUS_READY' });
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.digitalocean.com/v2/agents/sessions');
    expect(request.redirect).toBe('error');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer host-only-token' });
    expect(JSON.parse(request.body as string)).toEqual({ config_id: 'config-one', name: 'demo' });
    expect(request.body).not.toContain('host-only-token');
  });

  it('forks from the chosen checkpoint and validates every child session', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessions: [
      { session_id: 'child-one', status: 'SESSION_STATUS_PROVISIONING' },
      { session_id: 'child-two', status: 'SESSION_STATUS_PROVISIONING' },
    ] })));
    const runtime = new HarnessRuntime('host-token', fetcher as never);
    expect(await runtime.fork('parent', 2, 'cp_warm')).toHaveLength(2);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.digitalocean.com/v2/agents/sessions/parent/fork');
    expect(JSON.parse(request.body as string)).toEqual({ count: 2, from_checkpoint_id: 'cp_warm' });
    await expect(runtime.fork('parent', 5)).rejects.toMatchObject({ code: 'harness_protocol' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects malformed responses and never repeats provider response bodies in errors', async () => {
    const runtime = new HarnessRuntime('host-token', vi.fn(async () =>
      new Response('provider echoed host-token', { status: 401 })) as never);
    await expect(runtime.get('one')).rejects.toMatchObject({ code: 'harness_protocol' });
    await expect(runtime.get('one')).rejects.not.toThrow('host-token');
    const malformed = new HarnessRuntime('host-token', vi.fn(async () =>
      new Response(JSON.stringify({ session_id: [], status: 'READY' }))) as never);
    await expect(malformed.get('one')).rejects.toMatchObject({ code: 'harness_protocol' });
    await expect(malformed.get('../other')).rejects.toMatchObject({ code: 'harness_protocol' });
  });

  it('accepts omitted empty output fields while requiring an explicit command exit code', async () => {
    const runtime = new HarnessRuntime('host-token', vi.fn(async () =>
      new Response(JSON.stringify({ exit_code: 0 }))) as never);
    expect(await runtime.exec('one', ['true'])).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    const unknown = new HarnessRuntime('host-token', vi.fn(async () =>
      new Response(JSON.stringify({ stdout: 'done' }))) as never);
    await expect(unknown.exec('one', ['true'])).rejects.toMatchObject({ code: 'harness_protocol' });
  });
});

describe('B124: task coordinator stays behind host checks and board leases', () => {
  it('refuses candidate verification without an isolated validator before touching host state or the runtime', async () => {
    const runtime = { exec: vi.fn() };
    const bridge = new HarnessBundleHost({
      root: 'unused', ref: { id: 'demo', dir: 'unused', archived: false }, config: defaultConfig(),
      claim: { item, claim: { executor: item.executor } } as never,
      runtime: runtime as never, tool: 'codex',
    });
    await expect(bridge.verify('one', item)).rejects.toThrow('isolated candidate validator is required');
    expect(runtime.exec).not.toHaveBeenCalled();
  });

  function fixture(status = 'SESSION_STATUS_READY', exitCode = 0) {
    const runtime = {
      create: vi.fn(async () => ({ id: 'one', status })),
      get: vi.fn(async () => ({ id: 'one', status })),
      input: vi.fn(async () => {}),
      exec: vi.fn(async () => ({ exitCode, stdout: '', stderr: '' })),
    };
    const bridge = host();
    const adapter = new HarnessAdapter(runtime as never, bridge);
    return { runtime, bridge, adapter };
  }

  it('refuses an executor outside the registry task permission before allocating a session', async () => {
    const p = fixture();
    await expect(p.adapter.dispatch(executor, { ...item, risk: 'high' }, 'config'))
      .rejects.toMatchObject({ code: 'harness_refused' });
    expect(p.runtime.create).not.toHaveBeenCalled();
  });

  it('launches only after credentialless preparation, sending the unchanged task contract', async () => {
    const p = fixture();
    await p.adapter.dispatch(executor, item, 'config');
    await p.adapter.launch('one', item);
    expect(p.bridge.prepare).toHaveBeenCalledExactlyOnceWith('one', item);
    expect(p.runtime.input).toHaveBeenCalledExactlyOnceWith('one', JSON.stringify(item));
    expect(p.bridge.heartbeat).toHaveBeenCalledTimes(2);
    expect(p.bridge.prepare.mock.invocationCallOrder[0]).toBeLessThan(p.runtime.input.mock.invocationCallOrder[0]);
  });

  it('refuses a credential-bearing sandbox before sending a task or renewing its lease', async () => {
    const p = fixture('SESSION_STATUS_READY', 71);
    await expect(p.adapter.launch('one', item)).rejects.toMatchObject({ code: 'harness_refused' });
    expect(p.runtime.input).not.toHaveBeenCalled();
    expect(p.bridge.heartbeat).not.toHaveBeenCalled();
  });

  it('refuses an expired claim before preparing or sending work', async () => {
    const p = fixture();
    vi.mocked(p.bridge.heartbeat).mockRejectedValue(new Error('claim_expired'));
    await expect(p.adapter.launch('one', item)).rejects.toThrow('claim_expired');
    expect(p.bridge.prepare).not.toHaveBeenCalled();
    expect(p.runtime.input).not.toHaveBeenCalled();
  });

  it('refuses a claim that expires during preparation before sending work', async () => {
    const p = fixture();
    vi.mocked(p.bridge.heartbeat).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('claim_expired'));
    await expect(p.adapter.launch('one', item)).rejects.toThrow('claim_expired');
    expect(p.bridge.prepare).toHaveBeenCalledOnce();
    expect(p.runtime.input).not.toHaveBeenCalled();
  });

  it('an idle-paused or failed session never renews its board lease', async () => {
    for (const status of ['SESSION_STATUS_PAUSED', 'SESSION_STATUS_FAILED']) {
      const p = fixture(status);
      expect(await p.adapter.refresh('one')).toBe(status === 'SESSION_STATUS_PAUSED' ? 'paused' : 'stopped');
      expect(p.bridge.heartbeat).not.toHaveBeenCalled();
    }
  });

  it('offers only independently verified candidates, without duplicates', async () => {
    const p = fixture();
    vi.mocked(p.bridge.verify).mockImplementation(async (session) => ({ branch: session, passed: session === 'good' }));
    expect(await p.adapter.candidates(['bad', 'good', 'good'], item)).toEqual([{ session: 'good', branch: 'good' }]);
    expect(p.bridge.verify).toHaveBeenCalledTimes(2);
  });
});
