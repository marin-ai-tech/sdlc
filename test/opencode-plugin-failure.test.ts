import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { renderAll, renderContext } from '../src/integrations/install.js';
import { tempDir, write } from './helpers.js';

/**
 * The OpenCode plugin runs `sdlc hook` for every tool call. On Windows, OpenCode's runtime (Bun) sometimes reports
 * a spurious ETIMEDOUT from spawnSync after a few milliseconds; the plugin read every failure as "the CLI is not
 * installed" and let the call through, so an agent's edit of a protected file could pass unchecked. A failed check
 * must not mean "allowed": the plugin retries once, then blocks; only a CLI that is not installed is let through.
 */

const FAKE_HOOK = [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "const [mode, counter] = process.argv.slice(2);",
  "appendFileSync(counter, 'x');",
  "const calls = readFileSync(counter, 'utf8').length;",
  "const deny = JSON.stringify({ decision: 'deny', reason: '[sdlc:test] denied by the fake hook' });",
  "if (mode === 'deny') process.stdout.write(deny);",
  "if (mode === 'allow') process.stdout.write(JSON.stringify({ decision: 'allow' }));",
  "if (mode === 'silent') process.exit(0);",
  "if (mode === 'crash') process.exit(1);",
  "if (mode === 'garbage') process.stdout.write('not json');",
  "if (mode === 'flaky-deny') { if (calls === 1) process.exit(1); process.stdout.write(deny); }",
  "if (mode === 'flaky-allow') { if (calls === 1) process.exit(1); process.stdout.write('{\"decision\":\"allow\"}'); }",
].join('\n');

/** The generated plugin with `cli:` pointing at the fake hook in the given mode. */
async function plugin(cli: string) {
  const config = defaultConfig();
  config.cli = cli;
  const files = renderAll(renderContext(config, ['opencode']));
  const source = files.find((file) => file.path === '.opencode/plugins/sdlc.js')!.content;
  const file = path.join(tempDir('sdlc-oc-plugin-'), 'sdlc.mjs');
  write(file, source);
  const mod = await import(file);
  return mod.SdlcPlugin({ directory: tempDir('sdlc-oc-project-') });
}

function fake(mode: string) {
  const dir = tempDir('sdlc-fake-hook-');
  const script = path.join(dir, 'hook.mjs');
  const counter = path.join(dir, 'calls.txt');
  write(script, FAKE_HOOK);
  write(counter, '');
  const cli = ['node', script, mode, counter].map((part) => part.replace(/\\/g, '/')).join(' ');
  return { cli, calls: () => fs.readFileSync(counter, 'utf8').length };
}

const call = { tool: 'bash', sessionID: 's1', callID: 'c1' };
const args = () => ({ args: { command: 'sdlc approve intent --change demo' } });

describe('the OpenCode plugin when the check itself fails', () => {
  it('passes the decision through when the hook answers: deny blocks, allow and silence let through', async () => {
    const deny = fake('deny');
    await expect((await plugin(deny.cli))['tool.execute.before'](call, args())).rejects.toThrow(/denied by the fake hook/);
    for (const mode of ['allow', 'silent']) {
      const hook = fake(mode);
      await expect((await plugin(hook.cli))['tool.execute.before'](call, args()), mode).resolves.toBeUndefined();
      expect(hook.calls(), `${mode}: one run, no retry`).toBe(1);
    }
  }, 60000);

  it('a hook that fails once is run again and its answer counts', async () => {
    const flakyDeny = fake('flaky-deny');
    await expect((await plugin(flakyDeny.cli))['tool.execute.before'](call, args())).rejects.toThrow(/denied by the fake hook/);
    expect(flakyDeny.calls()).toBe(2);
    const flakyAllow = fake('flaky-allow');
    await expect((await plugin(flakyAllow.cli))['tool.execute.before'](call, args())).resolves.toBeUndefined();
    expect(flakyAllow.calls()).toBe(2);
  }, 60000);

  it('a check that keeps failing blocks the call and says why, instead of letting it through', async () => {
    for (const mode of ['crash', 'garbage']) {
      const hook = fake(mode);
      const run = (await plugin(hook.cli))['tool.execute.before'](call, args());
      await expect(run, mode).rejects.toThrow(/\[sdlc\][^\n]*could not (run|check)/i);
      await expect(run, mode).rejects.toThrow(/sdlc doctor/);
      expect(hook.calls(), `${mode}: tried twice`).toBe(2);
    }
  }, 60000);

  it('negative: when sdlc is not installed at all, the plugin keeps OpenCode usable', async () => {
    const missing = await plugin('sdlc-cli-that-does-not-exist-for-this-test');
    await expect(missing['tool.execute.before'](call, args())).resolves.toBeUndefined();
  }, 60000);

  it('negative: a failing session summary never blocks the session', async () => {
    const hook = fake('crash');
    const hooks = await plugin(hook.cli);
    const output = { system: [] as string[] };
    await expect(hooks['experimental.chat.system.transform']({ sessionID: 's1' }, output)).resolves.toBeUndefined();
    expect(output.system).toEqual([]);
  }, 60000);
});
