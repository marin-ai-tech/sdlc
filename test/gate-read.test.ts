import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES } from './farewell-fixture.js';
import { humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

describe('B127: gate read CLI', () => {
  it('returns reproducible normalized planning texts without writing state, log or checkpoint', () => {
    const root = tempDir('sdlc-gate-read-');
    initGitRepo(root);
    const env = humanEnv(tempDir('sdlc-home-'));
    const cli = (args: string[]) => runCli(args, root, { ...env, SDLC_AGENT: 'reader' });
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
    const dir = path.join(root, 'openspec/changes/demo');
    for (const [name, text] of Object.entries(FILES)) write(path.join(dir, name), text);
    const record = read(path.join(dir, '.sdlc.yaml'));
    const log = read(path.join(root, 'openspec/.sdlc/log.jsonl'));
    const refs = () => spawnSync('git', ['for-each-ref', 'refs/sdlc'], { cwd: root, encoding: 'utf8' }).stdout;
    const beforeRefs = refs();
    for (const gate of ['intent', 'spec', 'plan']) {
      const result = cli(['gate', 'read', gate, '--change', 'demo', '--json']);
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const out = result.json();
      expect(out.change).toBe('demo');
      expect(out.gate).toBe(gate);
      const hash = createHash('sha256');
      for (const file of out.snapshot.files) hash.update(`${file.path}\0${file.text}\0`);
      expect(out.snapshot.digest).toBe(`sha256:${hash.digest('hex')}`);
      expect(out.snapshot.files.some((file: { path: string }) => file.path === '.sdlc.yaml')).toBe(false);
      if (gate === 'plan') expect(out.snapshot.files.find((file: { path: string }) => file.path === 'tasks.md').text)
        .not.toContain('[x]');
    }
    expect(read(path.join(dir, '.sdlc.yaml'))).toBe(record);
    expect(read(path.join(root, 'openspec/.sdlc/log.jsonl'))).toBe(log);
    expect(refs()).toBe(beforeRefs);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/hook-log.jsonl'))).toBe(false);
    const defaultQueue = cli(['next', '--me', '--json']).json();
    const fastQueue = cli(['next', '--me', '--no-branches', '--json']).json();
    expect(defaultQueue).toHaveProperty('otherBranches');
    expect(fastQueue).not.toHaveProperty('otherBranches');
    expect(fastQueue.items).toEqual(defaultQueue.items);
  }, 120000);
});
