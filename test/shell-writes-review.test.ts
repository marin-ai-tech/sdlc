import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { shellWriteDestinations } from '../src/core/policy-shell-writes.js';
import { projectPaths } from '../src/core/project.js';
import { registryServerTable, setMcpTables } from '../src/integrations/codex-toml.js';
import { BIN, humanEnv, tempDir, write } from './helpers.js';

/**
 * 0.14.0 review of B82 (shell writes under the plan gate): text inside quotes and here-strings is content, not
 * commands; the common writers Codex uses on Windows are writes; pushd/popd are followed; an apply_patch run through
 * the shell is read; Codex's user-level files are guarded; shell writes respect protected paths.
 */

function dests(command: string, cwd = ''): string[] {
  const root = tempDir('sdlc-shell-writes-');
  return shellWriteDestinations(command, root, path.join(root, cwd)).sort();
}

function interpreterPolicy(command: string, child = false, prepare?: (root: string) => void) {
  const root = tempDir('sdlc-interpreter-projection-');
  write(path.join(root, 'openspec/backlog.md'), 'original');
  write(path.join(root, 'src/input.txt'), 'ordinary');
  prepare?.(root);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  const cwd = child ? path.join(root, 'src') : root;
  return evaluateToolCall(normalizeToolCall('Bash', { command }, cwd), { paths: projectPaths(root), config });
}

describe('Reviewed interpreter effects retain protected-state boundaries', () => {
  it.each(['writeFileSync', 'appendFileSync', 'writeFile', 'appendFile'])(
    'keeps nominal destination data out of an unproven writer projection: %s', name => {
      expect(dests(`node -e "fs.${name}('src/a.ts','x')"`)).toEqual(['src/a.ts']);
    },
  );

  it.each(['writeFileSync', 'appendFileSync', 'writeFile', 'appendFile'])(
    'retains protected literal candidates for an unproven writer: %s', name => {
      expect(interpreterPolicy(`node -e "fs.${name}('src/a.ts','openspec/backlog.md')"`).decision).toBe('deny');
    },
  );

  it.each(['writeFileSync', 'appendFileSync', 'writeFile', 'appendFile'])(
    'does not grant filesystem provenance to an unproven writer: %s', name => {
      expect(interpreterPolicy(`node -e "fs.${name}('src/a.ts','x')"`))
        .toMatchObject({ decision: 'deny', rule: 'shell-parse' });
    },
  );

  it.each([
    '{const first=0,{undefined}={undefined:{flag:"w+"}};require("fs").readFileSync("openspec/backlog.md",undefined)}',
    '{let first=0,{options:undefined}={options:{flag:"w+"}};require("fs").readFileSync("openspec/backlog.md",undefined)}',
    '{const first=(1,2),{nested:{undefined}}={nested:{undefined:{flag:"w+"}}};require("fs").readFileSync("openspec/backlog.md",undefined)}',
  ])('retains every declarator in intrinsic read-option proof: %s', code => {
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('deny');
  });

  it.each(['{}', '{encoding:"utf8"}'])('does not prove inherited read flags after property mutation: %s', options => {
    const code = `Object.prototype.flag="w+";require("fs").readFileSync("openspec/backlog.md",${options})`;
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('deny');
  });

  it.each(['', ',"utf8"', ',{flag:"r"}'])('retains own or intrinsic read flags after property mutation: %s', tail => {
    const code = `Object.prototype.flag="w+";require("fs").readFileSync("openspec/backlog.md"${tail})`;
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('allow');
  });

  it.each([
    "powershell -Command '$text=\"openspec/backlog.md\";Write-Output $text'",
    "powershell -Command '$text=1;$text'",
    "powershell -Command '$text = \"-e\";Write-Output $text'",
  ])('retains PowerShell binding and scalar data outside an executable interpreter frame: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('allow');
  });

  it.each(['$fs', 'fs$', '$fs$'])('retains namespace identity in a dollar-bearing capability: %s', name => {
    const code = `const ${name}=require("fs");JSON.parse({[Symbol.toPrimitive]:${name}["truncateSync"]})`;
    expect(interpreterPolicy(`node -e '${code}'`, false, root => {
      fs.linkSync(path.join(root, 'openspec/backlog.md'), path.join(root, 'string'));
    }).decision).toBe('deny');
  });

  it.each(['$fs', 'fs$', '$fs$'])('retains namespace identity in a dollar-bearing reader: %s', name => {
    const code = `const ${name}=require("fs");${name}.readFileSync("openspec/backlog.md")`;
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('allow');
  });

  it.each([
    '{const undefined={flag:"w+"};require("fs").readFileSync("openspec/backlog.md",undefined)}',
    '{let undefined={flag:"w+"};require("fs").readFileSync("openspec/backlog.md",undefined)}',
    'try{throw {flag:"w+"}}catch(undefined){require("fs").readFileSync("openspec/backlog.md",undefined)}',
    'const {options:undefined}={options:{flag:"w+"}};require("fs").readFileSync("openspec/backlog.md",undefined)',
    'const {first=0,options:undefined}={options:{flag:"w+"}};require("fs").readFileSync("openspec/backlog.md",undefined)',
    'for(const undefined of [{flag:"w+"}])require("fs").readFileSync("openspec/backlog.md",undefined)',
    'with(JSON.parse("{\\"undefined\\":{\\"flag\\":\\"w+\\"}}")){require("fs").readFileSync("openspec/backlog.md",undefined)}',
    '{const unde\\u0066ined={flag:"w+"};require("fs").readFileSync("openspec/backlog.md",undefined)}',
  ])('does not prove read-only options from a shadowed intrinsic: %s', code => {
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('deny');
  });

  it.each([
    'require("fs").readFileSync("openspec/backlog.md",undefined)',
    'const fs=require("fs");fs.readFileSync("openspec/backlog.md",undefined)',
    'require("fs").readFileSync("openspec/backlog.md",undefined);require("fs").readFileSync("openspec/backlog.md",undefined)',
    'const cfg=undefined;require("fs").readFileSync("openspec/backlog.md",undefined)',
    'try{require("fs").readFileSync("openspec/backlog.md",undefined)}catch(error){console.log(error.message)}',
  ])('retains read-only options from an unshadowed intrinsic: %s', code => {
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('allow');
  });

  it.each([
    'env "$FLAGS" node',
    '"$NODE"',
    'command "$PROGRAM"',
    '"$WRAPPER" node',
  ])('refuses an unresolved executable prefix: %s', prefix => {
    const code = "require('fs').writeFileSync('openspec/backlog.md','changed')";
    expect(interpreterPolicy(`${prefix} -e "${code}"`).decision).toBe('deny');
  });

  it.each([
    'env echo "$DATA"',
    'env SDLC_OWNED=1 echo "$DATA"',
    'echo "$NODE" -e "displayed data"',
  ])('retains ordinary arguments after a resolved executable prefix: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('allow');
  });

  it.each(['--version --no-version', '--help --no-help', '--check --no-check', '-v --no-version'])
    ('retains Node effects after native query cancellation: %s', options => {
      const code = "require('fs').writeFileSync('openspec/backlog.md','changed')";
      expect(interpreterPolicy(`node ${options} -e "${code}"`))
        .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each([
    'node -e "$CODE"',
    'node --eval="$CODE"',
    'node -p "$CODE"',
    'node --print=true "$CODE"',
    'node "$FLAGS" -e "console.log(1)"',
    'node -e "console.log(1)" "$FLAGS"',
    'node --title "$TITLE" -e "console.log(1)"',
    'node --title="$TITLE" -e "console.log(1)"',
    'node --version "$FLAGS" -e "console.log(1)"',
  ])('refuses unresolved executable Node word origins: %s', command => {
    expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    'node argv.cjs "$DATA"',
    'node --title literal argv.cjs "$DATA"',
    'node -e "console.log(1)" -- "$DATA"',
    'node -e "console.log(1)" MARKER "$DATA"',
    'node --version -- "$DATA"',
    "node --version --no-version --version -e \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --help --no-version -e \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --version --no-help -e \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
  ])('preserves Node data boundaries and independent query flags: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('allow');
  });

  it.each(['--print=true', '--print=false', '--print='])
    ('retains native Node launch effects for assigned print option: %s', option => {
      const code = "require('fs').writeFileSync(process.argv[1],'changed')";
      expect(interpreterPolicy(`node ${option} "${code}" openspec/backlog.md`).decision).toBe('deny');
    });

  it.each(['--print=true', '--print=false', '--print='])
    ('projects native Node launch destinations for assigned print option: %s', option => {
      const code = "require('fs').writeFileSync('src/output.txt','ordinary')";
      expect(dests(`node ${option} "${code}"`)).toEqual(['src/output.txt']);
    });

  it.each([
    "node argv.cjs --eval \"require('fs').writeFileSync(process.argv[1],'changed')\"",
    "node argv.cjs --eval=\"require('fs').writeFileSync(process.argv[1],'changed')\"",
    "node argv.cjs -p \"require('fs').writeFileSync(process.argv[1],'changed')\"",
    "node argv.cjs --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --title fixture argv.cjs --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node -p --no-warnings argv.cjs --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --eval \"console.log('ordinary')\" MARKER --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\" --eval \"console.log('ordinary')\"",
    "node --version --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --help --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\" --version",
    "node --help=false --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
  ])('preserves native Node launch argument and query boundaries: %s', command => {
    expect(interpreterPolicy(command, false, root => {
      write(path.join(root, 'argv.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
    }).decision).toBe('allow');
  });

  it.each([
    "node --input-type commonjs --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --title fixture --eval \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    'node --version > openspec/backlog.md',
  ])('retains native Node launch value-option effects and outer redirection: %s', command => {
    expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    { name: 'numeric output', code: 'console.log(1);'.repeat(8000) },
    { name: 'ASI variable declarations', code: 'var value=0\n'.repeat(9000)
      + "require('fs').readFileSync('openspec/backlog.md',undefined)" },
    { name: 'literal data calls', code: "JSON.parse('1');".repeat(7000) },
    { name: 'literal file effects', code: "const fs=require('fs');" + "fs.writeFileSync('notes.txt','ordinary');".repeat(2500) },
  ])('handles a supported Node input budget within the existing hook deadline: $name', ({ code }) => {
    const root = tempDir('sdlc-node-budget-hook-');
    const config = defaultConfig();
    config.enforcement.mode = 'block';
    config.enforcement.requireApprovedPlan = false;
    write(path.join(root, 'openspec/sdlc.yaml'), JSON.stringify(serializeConfig(config)));
    write(path.join(root, 'openspec/backlog.md'), 'original');
    const command = `node -e "${code}"`;
    expect(Buffer.byteLength(command)).toBeLessThan(131072);
    const result = spawnSync(process.execPath, [BIN, 'hook', 'pre-tool', '--agent', 'claude'], {
      cwd: root, env: humanEnv(tempDir('sdlc-node-budget-home-')), encoding: 'utf8', timeout: 20000,
      windowsHide: true, input: JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command } }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(fs.readFileSync(path.join(root, 'openspec/backlog.md'), 'utf8')).toBe('original');
  });

  it.each([
    'const fs=require("fs");JSON.parse({[Symbol.toPrimitive]:fs["truncateSync"]})',
    'const fs=require("fs");const copy={...fs};JSON.parse({[Symbol.toPrimitive]:copy["truncateSync"]})',
    'const {promises}=require("fs");JSON.parse({[Symbol.toPrimitive]:promises["truncate"]})',
  ])('refuses filesystem namespace capabilities with unresolved implicit effects: %s', code => {
    expect(interpreterPolicy(`node -e '${code}'`, false, root => {
      fs.linkSync(path.join(root, 'openspec/backlog.md'), path.join(root, 'string'));
    }).decision).toBe('deny');
  });

  it('retains filesystem namespace capabilities in a canonical promises reader binding', () => {
    const code = 'const {promises}=require("fs");promises.readFile("openspec/backlog.md")';
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('allow');
  });

  it.each([
    'JSON.parse("{\\"openspec/backlog.md\\":\\"changed\\"}",require("fs").writeFileSync)',
    'const fs=require("fs");JSON.parse("{\\"openspec/backlog.md\\":\\"changed\\"}",fs.writeFileSync)',
    'const {writeFileSync}=require("fs");JSON.parse("{\\"openspec/backlog.md\\":\\"changed\\"}",writeFileSync)',
    'JSON.parse("{\\"openspec/backlog.md\\":\\"changed\\"}",require("fs")["writeFileSync"])',
  ])('refuses a writer used as an executable standard callback: %s', code => {
    expect(interpreterPolicy(`node -e '${code}'`).decision).toBe('deny');
  });

  it.each([
    'JSON.parse("{\\"openspec/backlog.md\\":\\"ordinary\\"}")',
    'JSON.parse("{\\"openspec/backlog.md\\":\\"ordinary\\"}",null)',
    'JSON.parse("{\\"openspec/backlog.md\\":\\"ordinary\\"}",undefined)',
    'const cfg={writeFileSync:true};console.log("openspec/backlog.md")',
    'require("fs").readFileSync(process.argv[1])',
    'require("fs").readFileSync(process.argv[1],{flag:"r"})',
    'require("fs").readFileSync(process.argv[1],"utf8")',
  ])('retains inert standard callbacks and dynamic read-only path expressions: %s', code => {
    expect(interpreterPolicy(`node -e '${code}' openspec/backlog.md`).decision).toBe('allow');
  });

  it.each([
    "Reflect.set(require('fs'),'readFileSync',require('fs').writeFileSync);require('fs').readFileSync('openspec/backlog.md','changed')",
    "require('fs').__defineGetter__('readFileSync',()=>require('fs').writeFileSync);require('fs').readFileSync('openspec/backlog.md','changed')",
    "Object['defineProperty'](require('fs'),'readFileSync',{value:require('fs').writeFileSync});require('fs').readFileSync('openspec/backlog.md','changed')",
    "const poison=()=>{Reflect.set(require('fs'),'readFileSync',require('fs').writeFileSync)};poison();require('fs').readFileSync('openspec/backlog.md','changed')",
    "const pretend={readFileSync:require('fs').writeFileSync};pretend.readFileSync('openspec/backlog.md','changed')",
  ])('does not infer reader stability from an unclassified executable call: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "node -e \"require('fs').writeFileSync(process.argv[1],'changed')\" openspec/backlog.md",
    "node -e \"require('fs').readFileSync(process.argv[1],{flag:'w+'})\" openspec/backlog.md",
    "node -e \"require('fs').writeFileSync('openspec/\\u0062acklog.md','changed')\"",
    "node -e 'const name=\"backlog.md\";require(\"fs\").writeFileSync(`openspec/${name}`,\"changed\")'",
  ])('refuses an unresolved destination of a supported inline file operation: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('deny');
  });

  it.each([
    "const fs=require('fs');console.log(fs.readFileSync('openspec/backlog.md','utf8'))",
    "const io=require('fs/promises');io.readFile('openspec/backlog.md',{flag:'r'})",
    "const {readFileSync}=require('fs');readFileSync('openspec/backlog.md')",
    "console.log('openspec/backlog.md',Math.random())",
    "const cfg={log:true};Object.keys(cfg);console.log('openspec/backlog.md')",
    "console.log('Reflect.set(fake)');console.log('openspec/backlog.md')",
    "require('fs').writeFileSync('notes\\\\log.txt','ordinary')",
  ])('retains understood stable receivers and ordinary data expressions: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`).decision).toBe('allow');
  });

  it('retains a literal standard ESM filesystem namespace', () => {
    expect(interpreterPolicy("node --input-type=module -e \"import fs from 'node:fs';fs.readFileSync('openspec/backlog.md')\"")
      .decision).toBe('allow');
  });

  it.each([
    ['log', "console.log('openspec/backlog.md')"],
    ['require', "console.log('openspec/backlog.md')"],
    ['readFileSync', "require('fs').readFileSync('openspec/backlog.md')"],
    ['write', "process.stdout.write('openspec/backlog.md')"],
  ])('does not confuse an ordinary object data key with a reader binding: %s', (key, code) => {
    expect(interpreterPolicy(`node -e "const cfg={${key}:true};${code}"`).decision).toBe('allow');
  });

  it.each([
    "node -e \"require('fs').readFileSync('src/input.txt',{flag:'r'})\"",
    "node -e \"require('fs').readFileSync('src/input.txt',{encoding:'utf8'})\"",
  ])('does not invent writes from read-only option values: %s', command => {
    expect(dests(command)).toEqual([]);
  });

  it.each([
    ["node -e \"require('fs').readFileSync('src/input.txt',{flag:'r'})\"", 'r'],
    ["node -e \"require('fs').readFileSync('src/input.txt',{encoding:'utf8'})\"", 'utf8'],
  ])('does not resolve a read-only option value as an inode alias: %s', (command, alias) => {
    expect(interpreterPolicy(command, false, root => {
      fs.linkSync(path.join(root, 'openspec/backlog.md'), path.join(root, alias));
    }).decision).toBe('allow');
  });

  it.each([
    "require('fs').readFileSync&&=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')",
    "delete require('fs').readFileSync;require('fs').readFileSync??=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')",
    "// comment\u2028require('fs').readFileSync=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')",
    "require('fs').readFileSync=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')",
    "const readFileSync=require('fs').writeFileSync;readFileSync('openspec/backlog.md','changed')",
    "require('fs')['readFileSync']=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')",
    "Object.defineProperty(require('fs'),'readFileSync',{value:require('fs').writeFileSync});require('fs').readFileSync('openspec/backlog.md','changed')",
    "console.log=require('fs').writeFileSync;console.log('openspec/backlog.md','changed')",
  ])('invalidates a reader exemption after visible API replacement: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(['env --help > openspec/backlog.md', 'command -v node > openspec/backlog.md'])
    ('retains outer-shell redirection for a non-executing wrapper: %s', command => {
      expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each([
    "node -e \"console.log('readFileSync=openspec/backlog.md')\"",
    "node -e 'console.log(\"`${hi}`\");console.log(\"openspec/backlog.md\")'",
    "node -e '// `${hi}`\nconsole.log(\"openspec/backlog.md\")'",
    'env --help',
    'command -v node',
  ])('does not turn displayed API text or a query into an operation: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('allow');
  });

  it.each([
    "require('fs').readFileSync('openspec/backlog.md',{flag:'w+'})",
    "require('fs').readFile('openspec/backlog.md',{flag:'w+'},()=>{})",
    "require('fs').promises.readFile('openspec/backlog.md',{flag:'w+'})",
    "require('fs/promises').readFile('openspec/backlog.md',{flag:'a+'})",
    "require('fs').readFileSync('openspec/backlog.md',{flag:512})",
    "require('fs').readFileSync('openspec/backlog.md',options)",
    "require('fs').readFileSync('openspec/backlog.md',{flag:'r',...options})",
    "require('fs').readFileSync('openspec/backlog.md',{__proto__:{flag:'w+'}})",
  ])('retains a read API target when opening can modify it or is unclassified: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "require('fs').readFileSync('openspec/backlog.md')",
    "require('fs').readFileSync('openspec/backlog.md','utf8')",
    "require('fs').readFileSync('openspec/backlog.md',{encoding:'utf8'})",
    "require('fs').readFileSync('openspec/backlog.md',{encoding:'utf8',flag:'r'})",
    "require('fs').readFileSync('openspec/backlog.md',{flag:'rs'})",
    "require('fs').readFileSync('openspec/backlog.md',{flag:0})",
    "require('fs').readFile('openspec/backlog.md',()=>{})",
    "require('fs').promises.readFile('openspec/backlog.md',{flag:'r'})",
  ])('preserves a proven ordinary read opening: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`).decision).toBe('allow');
  });

  it.each([
    "env -C openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
    "env --chdir=openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
    "env -Copenspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
    "env -C src env -C ../openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
    "sudo -D openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
    "sudo --chdir=openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"",
  ])('resolves a recognized wrapper working directory before its writer target: %s', command => {
    expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "env -C openspec node -e \"console.log('harmless')\"",
    "env -C openspec node -e \"require('fs').readFileSync('backlog.md')\"",
    "env -C src node -e \"require('fs').writeFileSync('notes.txt','ordinary')\"",
    "env --chdir=openspec node -e \"console.log('harmless')\"",
    'powershell -Command "env -C src cp -a input.txt output"',
  ])('keeps harmless operations in a known wrapper directory: %s', command => {
    expect(interpreterPolicy(command).decision).toBe('allow');
  });

  it.each(['-e', '-p', '--print', '--eval', '-pe', '--eval=', '-p -e'])
    ('retains inode protection for each supported literal Node evaluation form: %s', option => {
      const code = "require('fs').writeFileSync('alias.md','changed')";
      const command = option.endsWith('=') ? `node ${option}"${code}"` : `node ${option} "${code}"`;
      const result = interpreterPolicy(command, false, root => {
        fs.linkSync(path.join(root, 'openspec/backlog.md'), path.join(root, 'alias.md'));
      });
      expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each(['-e', '-p', '--print', '--eval', '-pe', '--eval=', '-p -e'])
    ('retains protected-folder effects for each supported Node evaluation form: %s', option => {
      const code = "require('fs').rmSync('openspec',{recursive:true,force:true})";
      const command = option.endsWith('=') ? `node ${option}"${code}"` : `node ${option} "${code}"`;
      expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each(['-e', '-p', '--print', '--eval', '-pe', '--eval=', '-p -e'])
    ('projects ordinary destinations for each supported Node evaluation form: %s', option => {
      const code = "require('fs').writeFileSync('src/output.txt','ordinary')";
      const command = option.endsWith('=') ? `node ${option}"${code}"` : `node ${option} "${code}"`;
      expect(dests(command)).toEqual(['src/output.txt']);
    });

  it.each([
    "env -C src cp -R seed output",
    "env -C src bash -c 'cp -R seed output'",
    'powershell -Command "env -C src cp -a seed output"',
  ])('uses the same wrapper context for a state-bearing source copy: %s', command => {
    const result = interpreterPolicy(command, false, root => write(path.join(root, 'src/seed/.sdlc.yaml'), 'authority'));
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "env node -e \"require('fs').copyFileSync('input.txt','openspec/backlog.md')\"",
    "sudo -u someone node -e \"require('fs').appendFile('openspec/backlog.md','changed',()=>{})\"",
    "/usr/bin/env node -e \"require('fs').copyFileSync('input.txt','openspec/backlog.md')\"",
  ])('keeps a literal writer behind a recognized native wrapper: %s', command => {
    expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "require('fs').appendFile('openspec/backlog.md','changed',e=>{if(e)throw e})",
    "require('fs').copyFileSync('input.txt','openspec/backlog.md')",
    "require('fs').renameSync('input.txt','openspec/backlog.md')",
    "require('fs').unlinkSync('openspec/backlog.md')",
    "require('fs').truncateSync('openspec/backlog.md',0)",
    "require('fs').openSync('openspec/backlog.md','w')",
    "require('fs')['appendFile']('openspec/backlog.md','changed',()=>{})",
    "const target='openspec/backlog.md';require('fs').writeFileSync(target,'changed')",
  ])('refuses a literal protected target in a static Node operation: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    ['node -e "require(\'fs\').writeFileSync(\'../openspec/backlog.md\',\'changed\')"', true],
    ['cd src; node -e "require(\'fs\').writeFileSync(\'../openspec/backlog.md\',\'changed\')"', false],
    ["sed -i 's/original/changed/' ../openspec/backlog.md", true],
  ] as const)('keeps the real project boundary for %s', (command, child) => {
    expect(interpreterPolicy(command, child)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "node -p \"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
    "node --eval=\"require('fs').writeFileSync('openspec/backlog.md','changed')\"",
  ])('retains effects of supported Node evaluation forms: %s', command => {
    expect(interpreterPolicy(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('keeps displayed command arguments separate from an executed Node program', () => {
    expect(interpreterPolicy("env echo node -e \"require('fs').appendFile('openspec/backlog.md','changed',()=>{})\"")
      .decision).toBe('allow');
  });

  it.each([
    ['python -c "import shutil;shutil.copy(\'input.txt\',\'openspec/backlog.md\')"', 'deny'],
    ['python -c "import os;os.remove(\'openspec/backlog.md\')"', 'deny'],
    ['python -c "from pathlib import Path;Path(\'openspec/backlog.md\').write_text(\'changed\')"', 'deny'],
    ['python -c "print(\'openspec/backlog.md\')"', 'allow'],
    ['python -c "print(open(\'openspec/backlog.md\').read())"', 'allow'],
    ['python -c "from pathlib import Path;print(Path(\'openspec/backlog.md\').read_text())"', 'allow'],
    ['python -c "import shutil;shutil.copy(\'openspec/backlog.md\',\'notes.txt\')"', 'allow'],
    ['perl -e \'open(FH, ">openspec/backlog.md"); print FH "changed";\'', 'deny'],
    ['perl -e \'print "openspec/backlog.md";\'', 'allow'],
    ['perl -e \'open(FH, "<", "openspec/backlog.md"); print <FH>;\'', 'allow'],
  ] as const)('retains static Python and Perl effects without treating output as a path: %s', (command, decision) => {
    expect(interpreterPolicy(command).decision).toBe(decision);
  });

  it.each([
    "console.log('openspec/backlog.md')",
    "process.stdout.write(require('fs').readFileSync('openspec/backlog.md','utf8'))",
    "require('fs').writeFileSync('notes.txt','openspec/backlog.md')",
    "require('fs').copyFileSync('openspec/backlog.md','notes.txt')",
    "require('fs').openSync('openspec/backlog.md','r')",
  ])('retains harmless output, reads and ordinary destinations: %s', code => {
    expect(interpreterPolicy(`node -e "${code}"`).decision).toBe('allow');
  });

  it.each([
    ["node -e \"require('fs').readFileSync=require('fs').writeFileSync;require('fs').readFileSync('openspec/backlog.md','changed')\"", false, 'deny'],
    ['env --help > openspec/backlog.md', false, 'deny'],
    ['command -v node > openspec/backlog.md', false, 'deny'],
    ['env --help', false, 'allow'],
    ["node -e \"require('fs').readFileSync('openspec/backlog.md',{flag:'w+'})\"", false, 'deny'],
    ["node -e \"require('fs').promises.readFile('openspec/backlog.md',{flag:'w+'})\"", false, 'deny'],
    ["env -C openspec node -e \"require('fs').writeFileSync('backlog.md','changed')\"", false, 'deny'],
    ["env --chdir=openspec node -e \"console.log('harmless')\"", false, 'allow'],
    ["node -p \"require('fs').writeFileSync('alias.md','changed')\"", false, 'deny', true],
    ["node -e \"require('fs').appendFile('openspec/backlog.md','changed',()=>{})\"", false, 'deny'],
    ["node -e \"require('fs').copyFileSync('input.txt','openspec/backlog.md')\"", false, 'deny'],
    ["node -e \"require('fs')['appendFile']('openspec/backlog.md','changed',()=>{})\"", false, 'deny'],
    ["node -e \"require('fs').writeFileSync('../openspec/backlog.md','changed')\"", true, 'deny'],
    ["cd src; node -e \"require('fs').writeFileSync('../openspec/backlog.md','changed')\"", false, 'deny'],
    ["sed -i 's/original/changed/' ../openspec/backlog.md", true, 'deny'],
    ["node -e \"console.log('openspec/backlog.md')\"", false, 'allow'],
    ["node -e \"require('fs').copyFileSync('openspec/backlog.md','notes.txt')\"", false, 'allow'],
    ["node -p \"require('fs').writeFileSync('openspec/backlog.md','changed')\"", false, 'deny'],
    ["node --eval=\"require('fs').writeFileSync('openspec/backlog.md','changed')\"", false, 'deny'],
    ["env echo node -e \"require('fs').appendFile('openspec/backlog.md','changed',()=>{})\"", false, 'allow'],
    ['python -c "import shutil;shutil.copy(\'input.txt\',\'openspec/backlog.md\')"', false, 'deny'],
    ['perl -e \'open(FH, ">openspec/backlog.md"); print FH "changed";\'', false, 'deny'],
    ['python -c "print(\'openspec/backlog.md\')"', false, 'allow'],
    ['perl -e \'print "openspec/backlog.md";\'', false, 'allow'],
  ] as const)('preserves the reviewed boundary through the actual hook: %s', (command, child, decision, alias = false) => {
    const root = tempDir('sdlc-interpreter-hook-');
    write(path.join(root, 'openspec/backlog.md'), 'original');
    write(path.join(root, 'src/input.txt'), 'ordinary');
    if (alias) fs.linkSync(path.join(root, 'openspec/backlog.md'), path.join(root, 'alias.md'));
    const config = defaultConfig();
    config.enforcement.mode = 'block';
    config.enforcement.requireApprovedPlan = false;
    write(path.join(root, 'openspec/sdlc.yaml'), JSON.stringify(serializeConfig(config)));
    const cwd = child ? path.join(root, 'src') : root;
    const result = spawnSync(process.execPath, [BIN, 'hook', 'pre-tool', '--agent', 'claude'], {
      cwd, env: humanEnv(tempDir('sdlc-interpreter-hook-home-')), encoding: 'utf8', timeout: 15000,
      windowsHide: true, input: JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    if (decision === 'deny') {
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain('state-integrity');
    } else expect(result.stdout.trim()).toBe('');
  });
});

describe('quoted text is content, not commands', () => {
  const cases: Array<[string, string[]]> = [
    ["Set-Content -LiteralPath 'openspec/changes/demo/intent.md' -Value 'Users -> admins'",
      ['openspec/changes/demo/intent.md']],
    ["Set-Content -Path 'openspec/x.md' -Value \"line one\n> Note\nCopy a b\nMove c d\"", ['openspec/x.md']],
    ["Set-Content openspec/x.md @\"\n<div>x</div>\ntee src/a.ts\n\"@", ['openspec/x.md']],
    ["Set-Content openspec/x.md @'\nUsers -> admins\n'@", ['openspec/x.md']],
    ['git commit -m "a -> b"', []],
    ['node -e "[1].map(x => x)"', []],
    ['rg "a > b" src', []],
    ["echo 'x' > 'src/my file.ts'", ['src/my file.ts']],
  ];
  for (const [command, expected] of cases) {
    it(JSON.stringify(command), () => {
      expect(dests(command)).toEqual(expected);
    });
  }
});

describe('the common writers are writes', () => {
  const cases: Array<[string, string[]]> = [
    ["[IO.File]::WriteAllText('src/a.ts', 'x')", ['src/a.ts']],
    ['[System.IO.File]::AppendAllText("src/a.ts", "x")', ['src/a.ts']],
    ['sc src/a.ts x', ['src/a.ts']],
    ["'x' | Tee-Object -FilePath src/a.ts", ['src/a.ts']],
    ['Rename-Item src/old.ts new.ts', ['src/new.ts', 'src/old.ts']],
    ['Set-Content -Pa src/a.ts -Va x', ['src/a.ts']],
    ['Copy-Item x.ts -Dest src/a.ts', ['src/a.ts']],
    ["'x' | Out-File -FileP src/a.ts", ['src/a.ts']],
    ['& { Set-Content src/a.ts x }', ['src/a.ts']],
    ['if (1) { Set-Content src/a.ts x }', ['src/a.ts']],
    ["sed -i 's/a/b/' src/a.ts", ['src/a.ts']],
    ["perl -pi -e 's/a/b/' src/a.ts", ['src/a.ts']],
    ['touch src/a.ts', ['src/a.ts']],
    ['truncate -s 0 src/a.ts', ['src/a.ts']],
    ['dd if=/dev/zero of=src/a.ts count=1', ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(dests(command)).toEqual(expected);
    });
  }

  it('negative: reads and searches stay no targets', () => {
    for (const command of ['sed -n 1,5p src/a.ts', "sed 's/a/b/' src/a.ts", 'Get-Content src/a.ts',
      '[IO.File]::ReadAllText("src/a.ts")', 'Select-String -Path src/a.ts -Pattern x', 'cat src/a.ts']) {
      expect(dests(command), command).toEqual([]);
    }
  });
});

describe('the directory is followed', () => {
  it('pushd/popd and Push-Location/Pop-Location', () => {
    expect(dests('pushd openspec; popd; echo x > src/a.ts')).toEqual(['src/a.ts']);
    expect(dests('Push-Location openspec; Pop-Location; Set-Content src/a.ts x')).toEqual(['src/a.ts']);
    expect(dests('pushd openspec && echo x > notes.md')).toEqual(['openspec/notes.md']);
  });
});

describe('an apply_patch run through the shell', () => {
  it('its files are targets', () => {
    const command = "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: src/a.ts\n+x\n*** End Patch\nEOF";
    expect(dests(command)).toEqual(['src/a.ts']);
  });

  it('negative: another here-document body is still text', () => {
    expect(dests("cat > openspec/x.md <<'EOF'\n*** Add File: src/a.ts\nEOF")).toEqual(['openspec/x.md']);
  });
});

function policy() {
  const root = tempDir('sdlc-shell-writes-policy-');
  const home = tempDir('sdlc-shell-writes-home-');
  write(path.join(root, 'src/app.js'), 'a\n');
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  config.enforcement.protectedPaths = ['infra/**'];
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const ctx = { paths: projectPaths(root), config, env };
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  const edit = (file: string) => evaluateToolCall(normalizeToolCall('Write', { file_path: file }, root), ctx);
  return { root, home: home.replace(/\\/g, '/'), shell, edit };
}

describe("Codex's user-level files are the guard's configuration", () => {
  it('an agent cannot write ~/.codex/config.toml or hooks.json, by shell or by edit', () => {
    const p = policy();
    const deny = { decision: 'deny', rule: 'guard-config' };
    expect(p.shell(`Add-Content ${p.home}/.codex/config.toml 'x'`)).toMatchObject(deny);
    expect(p.shell("Set-Content ~/.codex/hooks.json '{}'")).toMatchObject(deny);
    expect(p.edit(`${p.home}/.codex/config.toml`)).toMatchObject(deny);
  });

  it('CODEX_HOME is followed', () => {
    const p = policy();
    const other = tempDir('sdlc-codex-home-').replace(/\\/g, '/');
    const root = tempDir('sdlc-shell-writes-policy-');
    const config = defaultConfig();
    config.enforcement.requireApprovedPlan = false;
    const env = { HOME: p.home, USERPROFILE: p.home, CODEX_HOME: other };
    const ctx = { paths: projectPaths(root), config, env };
    const call = normalizeToolCall('Write', { file_path: `${other}/config.toml` }, root);
    expect(evaluateToolCall(call, ctx)).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it('negative: other files under ~/.codex stay writable', () => {
    const p = policy();
    expect(p.edit(`${p.home}/.codex/AGENTS.md`).decision).not.toBe('deny');
  });
});

describe('shell writes respect protected paths', () => {
  it('a write to a protected path through the shell is denied like an edit', () => {
    const p = policy();
    expect(p.edit('infra/x.tf')).toMatchObject({ decision: 'deny', rule: 'protected-path' });
    expect(p.shell("Set-Content infra/x.tf 'x'")).toMatchObject({ decision: 'deny', rule: 'protected-path' });
    expect(p.shell('echo x > infra/x.tf')).toMatchObject({ decision: 'deny', rule: 'protected-path' });
  });

  it('negative: reading a protected path is allowed', () => {
    expect(policy().shell('cat infra/x.tf').decision).toBe('allow');
  });
});

describe("PowerShell's all-streams redirect", () => {
  it('npm test *> $null is not a write to the project', () => {
    expect(policy().shell('npm test *> $null').decision).toBe('allow');
  });
});

describe("Codex's TOML", () => {
  it("a person's comment before the next table survives replacing and removing sdlc's table", () => {
    const text = '[mcp_servers.sdlc]\ncommand = "sdlc"\n\n# my server\n[mcp_servers.mine]\ncommand = "x"\n';
    const replaced = setMcpTables(text, { sdlc: '[mcp_servers.sdlc]\ncommand = "npx"' });
    expect(replaced).toContain('# my server\n[mcp_servers.mine]');
    expect(setMcpTables(text, { sdlc: undefined })).toContain('# my server\n[mcp_servers.mine]');
  });

  it('U+007F is escaped in strings', () => {
    const table = registryServerTable({ name: 'x', type: 'stdio', command: ['a\u007fb'], env: {} } as never);
    expect(table).not.toContain('\u007f');
    expect(table).toContain('\\u007F');
  });
});

/** Review follow-up: cases a first fix broke or missed. */
describe('follow-up: no new false positives', () => {
  for (const command of ['npm test 2>&1', 'git status 2>&1', 'npx vitest run > /dev/null 2>&1', 'node x.js 2>&-',
    'npm test 1>&2', 'npm test *>&1']) {
    it(command, () => {
      expect(dests(command)).toEqual([]);
    });
  }
});

describe('follow-up: no new bypasses', () => {
  const cases: Array<[string, string[]]> = [
    ["echo 'x\\' > src/a.ts", ['src/a.ts']],
    ["Write-Output 'C:\\tmp\\'; echo x > src/a.ts", ['src/a.ts']],
    ['New-Item -ItemType File src/a.ts', ['src/a.ts']],
    ['Set-Content -Encoding utf8 src/a.ts x', ['src/a.ts']],
    ['try { Set-Content src/a.ts x } catch { }', ['src/a.ts']],
    ['if (Test-Path x) { Set-Content src/a.ts x }', ['src/a.ts']],
    ['if ($a) { Get-Content x } else { Set-Content src/a.ts x }', ['src/a.ts']],
    ['foreach ($f in $files) { Set-Content src/a.ts x }', ['src/a.ts']],
    ['bash -c "echo x > src/a.ts"', ['src/a.ts']],
    ["sh -c 'cp b.ts src/a.ts'", ['src/a.ts']],
    ['cmd /c "echo x > src\\a.ts"', ['src/a.ts']],
    ['powershell -Command "Set-Content src/a.ts x"', ['src/a.ts']],
    ["pwsh -c 'Set-Content src/a.ts x'", ['src/a.ts']],
    ["sed -i.bak 's/a/b/' src/a.ts", ['src/a.ts']],
    ['echo "x <<EOF" > src/a.ts', ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(dests(command)).toEqual(expected);
    });
  }

  it('negative: a message that only mentions a shell is still text', () => {
    expect(dests('git commit -m "run bash -c \'echo x > src/a.ts\' later"')).toEqual([]);
  });
});

describe("follow-up: Codex's TOML keeps the person's comments on both sides", () => {
  it("commented keys at the end of a person's table before sdlc's table survive removing sdlc's", () => {
    const text = '[mcp_servers.mine]\ncommand = "x"\n# args = ["y"]\n\n[mcp_servers.sdlc]\ncommand = "sdlc"\n';
    expect(setMcpTables(text, { sdlc: undefined })).toContain('command = "x"\n# args = ["y"]');
    const replaced = setMcpTables(text, { sdlc: '[mcp_servers.sdlc]\ncommand = "npx"' });
    expect(replaced).toContain('# args = ["y"]');
    expect(replaced).toContain('command = "npx"');
    expect(replaced).not.toContain('command = "sdlc"');
  });
});
