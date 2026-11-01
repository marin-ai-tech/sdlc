import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

export function nativeVerifyProbe(command: string, timeoutSeconds: number, prefix = '') {
  const root = tempDir('sdlc-native-verify-');
  initGitRepo(root);
  const runner = path.join(root, 'runner.mjs');
  const wrapper = path.join(root, 'delayed-wrapper.ps1');
  const invocation = path.join(root, 'invocation.json');
  const verify = pathToFileURL(path.join(REPO_ROOT, 'dist/core/verify.js')).href;
  const config = pathToFileURL(path.join(REPO_ROOT, 'dist/core/config.js')).href;
  write(runner, ["import fs from 'node:fs';", "import cp from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';", 'const original = cp.spawn;',
    'cp.spawn = function(executable, args, options) {',
    `  fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({ executable, args }));`,
    "  const file = args?.indexOf('-File') ?? -1;",
    `  if (file >= 0 && ${JSON.stringify(prefix)} !== '') {`,
    `    fs.writeFileSync(${JSON.stringify(wrapper)}, ${JSON.stringify(prefix)} + fs.readFileSync(args[file + 1], 'utf8'));`,
    '    args = [...args];', `    args[file + 1] = ${JSON.stringify(wrapper)};`, '  }',
    '  return original.call(this, executable, args, options);', '};', 'syncBuiltinESMExports();',
    `const { runVerification } = await import(${JSON.stringify(verify)});`,
    `const { defaultConfig } = await import(${JSON.stringify(config)});`, 'const config = defaultConfig();',
    `config.verify.commands = [{ name: 'native', run: ${JSON.stringify(command)}, required: true }];`,
    `config.verify.timeoutSeconds = ${timeoutSeconds};`, 'config.verify.outputLines = 100;',
    `console.log(JSON.stringify(await runVerification(${JSON.stringify(root)}, config)));`,
  ].join('\n'));
  return { root, invocation, run: () => {
    const out = spawnSync(process.execPath, [runner], { cwd: root, env: humanEnv(tempDir('sdlc-native-home-')),
      encoding: 'utf8', timeout: 45000, windowsHide: true });
    return { ...out, result: () => JSON.parse(out.stdout), invocation: () => JSON.parse(read(invocation)) };
  } };
}

export function windowsProgram(name: string): string {
  return path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', name);
}

export function quotedProgramFixture(): string {
  const file = path.join(tempDir('sdlc-program space-'), 'quoted program.exe');
  fs.copyFileSync(windowsProgram('whoami.exe'), file);
  return file;
}
