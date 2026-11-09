import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B248, one list of known writers reads every check. The oracle is a plain redirect: a known writer that writes a file
 * gets the decision and the rule that `echo x > <file>` gets for the same file, in the same project. Read forms of the
 * same programs, and writes outside the project, stay allowed.
 */

interface Target {
  name: string;
  file: string;
  rule: string;
  situation: Situation;
}

interface Situation {
  planRequired?: boolean;
  testsLocked?: boolean;
}

const TARGETS: Target[] = [
  { name: 'a state file', file: 'openspec/roles.yaml', rule: 'state-integrity', situation: {} },
  { name: 'a guard file', file: 'opencode.json', rule: 'guard-config', situation: {} },
  { name: 'a protected path', file: 'src/gen/x.ts', rule: 'protected-path', situation: {} },
  { name: 'a locked test', file: 'src/a.test.ts', rule: 'tests-locked', situation: { testsLocked: true } },
  { name: 'a source file with no plan', file: 'src/a.ts', rule: 'plan-gate', situation: { planRequired: true } },
];
const FILES = ['openspec/roles.yaml', 'opencode.json', 'src/gen/x.ts', 'src/a.test.ts', 'src/a.ts', 'a', 'a.tar'];

const stands = new Map<string, string>();

function standFor(situation: Situation): string {
  const key = JSON.stringify(situation);
  const known = stands.get(key);
  if (known) return known;
  const root = tempDir('sdlc-b248-writers-');
  for (const file of FILES) write(path.join(root, file), 'original\n');
  if (situation.testsLocked) {
    const dir = path.join(root, 'openspec/changes/fix');
    write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
    writeChangeState(dir, { ...newChangeState(), kind: 'bugfix', tests_locked: true });
  }
  stands.set(key, root);
  return root;
}

function decide(command: string, situation: Situation = {}, tool = 'Bash') {
  const root = standFor(situation);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = situation.planRequired === true;
  config.enforcement.protectedPaths = ['src/gen/**'];
  const call = normalizeToolCall(tool, { command }, root);
  const result = evaluateToolCall(call, { paths: projectPaths(root), config });
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

/** The writer gets what a plain redirect to the same file gets, and that is the target's rule. */
function expectLikeRedirect(command: string, target: Target, tool = 'Bash') {
  const redirect = decide(`echo x > ${target.file}`, target.situation);
  expect(redirect, `redirect to ${target.file}`).toEqual({ decision: 'deny', rule: target.rule });
  expect(decide(command, target.situation, tool), command).toEqual(redirect);
}

function expectAllowed(command: string, situation: Situation = {}, tool = 'Bash') {
  expect(decide(command, situation, tool), command).toEqual({ decision: 'allow', rule: undefined });
}

type Form = [string, (file: string) => string];

const REDIRECTS: Form[] = [
  ['the clobber redirect', (f) => `echo x >| ${f}`],
  ['>& with a file', (f) => `echo x >& ${f}`],
  ['&>', (f) => `echo x &> ${f}`],
  ['&>>', (f) => `echo x &>> ${f}`],
  ['2>', (f) => `echo x 2> ${f}`],
];

const POSIX_WRITERS: Form[] = [
  ['install', (f) => `install a ${f}`],
  ['curl -o', (f) => `curl -o ${f} http://example.test/x`],
  ['curl --output', (f) => `curl --output ${f} http://example.test/x`],
  ['curl --output=', (f) => `curl --output=${f} http://example.test/x`],
  ['curl -sSLo', (f) => `curl -sSLo ${f} http://example.test/x`],
  ['wget -O', (f) => `wget -O ${f} http://example.test/x`],
  ['wget --output-document=', (f) => `wget --output-document=${f} http://example.test/x`],
  ['sort -o', (f) => `sort -o ${f} a`],
  ['sort with -o last', (f) => `sort a -o ${f}`],
  ['sort --output=', (f) => `sort --output=${f} a`],
  ['sort -o glued to the file', (f) => `sort -o${f} a`],
  ['rsync', (f) => `rsync a ${f}`],
  ['patch', (f) => `patch ${f} a`],
  ['patch -o', (f) => `patch -o ${f} a`],
  ['tar -cf', (f) => `tar -cf ${f} a`],
  ['tar --file= with -c', (f) => `tar --file=${f} -c a`],
  ['touch', (f) => `touch ${f}`],
  ['unlink', (f) => `unlink ${f}`],
  ['chmod', (f) => `chmod 644 ${f}`],
  ['chown', (f) => `chown someone ${f}`],
  ['sponge', (f) => `cat a | sponge ${f}`],
  ['truncate', (f) => `truncate -s 0 ${f}`],
  ['yq -i', (f) => `yq -i '.a = 1' ${f}`],
];

const GIT_WRITERS: Form[] = [
  ['git show --output=', (f) => `git show --output=${f} HEAD`],
  ['git diff --output=', (f) => `git diff --output=${f}`],
  ['git config -f', (f) => `git config -f ${f} a.b c`],
  ['git config --file=', (f) => `git config --file=${f} a.b c`],
  ['git config --file', (f) => `git config --file ${f} a.b c`],
];

const EVAL_WRITERS: Form[] = [
  ['eval of a redirect', (f) => `eval "echo x > ${f}"`],
  ['eval of a delete', (f) => `eval 'rm ${f}'`],
  ['eval of a tee', (f) => `eval "echo x | tee ${f}"`],
];

const POWERSHELL_WRITERS: Form[] = [
  ['Export-Csv -Path', (f) => `Get-Process | Export-Csv -Path ${f}`],
  ['Export-Csv', (f) => `Get-Process | Export-Csv ${f}`],
  ['Set-Item', (f) => `Set-Item ${f} x`],
  ['New-Item', (f) => `New-Item ${f}`],
  ['Remove-Item', (f) => `Remove-Item ${f}`],
  ['ri', (f) => `ri ${f}`],
  ['Start-Process -RedirectStandardOutput', (f) => `Start-Process x -RedirectStandardOutput ${f}`],
  ['Start-Process -RedirectStandardError', (f) => `Start-Process x -RedirectStandardError ${f}`],
  ['[IO.File]::WriteAllText', (f) => `[IO.File]::WriteAllText("${f}", "x")`],
  ['[IO.StreamWriter]::new', (f) => `[IO.StreamWriter]::new("${f}")`],
  ['[IO.FileStream]::new', (f) => `[IO.FileStream]::new("${f}", "Create")`],
  ['New-Object IO.StreamWriter', (f) => `New-Object IO.StreamWriter ${f}`],
  ['New-Object System.IO.StreamWriter()', (f) => `New-Object System.IO.StreamWriter("${f}")`],
  ['[IO.FileInfo] Delete', (f) => `[IO.FileInfo]::new("${f}").Delete()`],
  ['iex of a write', (f) => `iex 'Set-Content ${f} x'`],
];

/** Writers the policy already knew before B248; moving them into one list must not drop any. */
const OLD_WRITERS: Form[] = [
  ['a redirect', (f) => `echo x > ${f}`],
  ['an append', (f) => `echo x >> ${f}`],
  ['tee', (f) => `echo x | tee ${f}`],
  ['tee -a', (f) => `echo x | tee -a ${f}`],
  ['Tee-Object', (f) => `Get-Date | Tee-Object -FilePath ${f}`],
  ['cp', (f) => `cp a ${f}`],
  ['mv', (f) => `mv a ${f}`],
  ['sed -i', (f) => `sed -i s/o/0/ ${f}`],
  ['sed w', (f) => `sed -n 'w ${f}' a`],
  ['perl -pi', (f) => `perl -pi -e 's/o/0/' ${f}`],
  ['awk output', (f) => `awk '{print > "${f}"}' a`],
  ['dd of=', (f) => `dd if=a of=${f}`],
  ['Set-Content', (f) => `Set-Content ${f} x`],
  ['Add-Content', (f) => `Add-Content ${f} x`],
  ['Clear-Content', (f) => `Clear-Content ${f}`],
  ['Out-File', (f) => `Get-Date | Out-File ${f}`],
  ['sc', (f) => `sc ${f} x`],
  ['ni', (f) => `ni ${f}`],
  ['Copy-Item', (f) => `Copy-Item a ${f}`],
  ['Move-Item', (f) => `Move-Item a ${f}`],
  ['Rename-Item of the file', (f) => `Rename-Item ${f} other`],
  ['[IO.File]::AppendAllText', (f) => `[IO.File]::AppendAllText("${f}", "x")`],
  ['[IO.File]::Delete', (f) => `[IO.File]::Delete("${f}")`],
  ['Invoke-WebRequest -OutFile', (f) => `Invoke-WebRequest http://example.test -OutFile ${f}`],
  ['iwr -OutF', (f) => `iwr http://example.test -OutF ${f}`],
  ['git checkout --', (f) => `git checkout -- ${f}`],
  ['git restore', (f) => `git restore ${f}`],
  ['git mv', (f) => `git mv a ${f}`],
  ['node -e writeFileSync', (f) => `node -e "require('fs').writeFileSync('${f}', 'x')"`],
  ['python -c open w', (f) => `python -c "open('${f}', 'w').write('x')"`],
];

const POWERSHELL = new Set([...POWERSHELL_WRITERS, ...OLD_WRITERS.slice(12, 25)].map(([name]) => name));
const CASES = (forms: Form[]) => TARGETS.flatMap((target) => forms.map(([name, form]) =>
  [`${name} of ${target.name}`, form(target.file), target, POWERSHELL.has(name) ? 'PowerShell' : 'Bash'] as const));

describe('B248.W1: redirects', () => {
  it.each(CASES(REDIRECTS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });
});

describe('B248.W2: POSIX writers', () => {
  it.each(CASES(POSIX_WRITERS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });

  it.each([['openspec', 'state-integrity', {}], ['src', 'plan-gate', { planRequired: true }]] as const)(
    'tar -x -C into %s', (dir, rule, situation) => {
      expect(decide(`tar -xf a.tar -C ${dir}`, situation)).toEqual({ decision: 'deny', rule });
    },
  );
});

describe('B248.W3: git writers', () => {
  it.each(CASES(GIT_WRITERS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });
});

describe('Verification of B248: a writer inside a compound command or a wrapper', () => {
  const PREFIXES: Array<[string, (inner: string) => string]> = [
    ['then', (inner) => `if true; then ${inner}; fi`],
    ['do', (inner) => `for i in 1; do ${inner}; done`],
    ['while do', (inner) => `while false; do ${inner}; done`],
    ['else', (inner) => `if false; then :; else ${inner}; fi`],
    ['!', (inner) => `! ${inner}`],
    ['time', (inner) => `time ${inner}`],
    ['nohup', (inner) => `nohup ${inner}`],
    ['nice', (inner) => `nice -n 5 ${inner}`],
  ];
  const INNER: Form[] = [
    ['touch', (f) => `touch ${f}`],
    ['rm', (f) => `rm ${f}`],
    ['sed -i', (f) => `sed -i s/o/0/ ${f}`],
  ];
  const cases = TARGETS.flatMap((target) => PREFIXES.flatMap(([prefix, wrap]) => INNER.map(([name, form]) =>
    [`${name} after ${prefix} on ${target.name}`, wrap(form(target.file)), target] as const)));

  it.each(cases)('%s', (_title, command, target) => {
    expectLikeRedirect(command, target);
  });

  it.each([['if true; then cat openspec/roles.yaml; fi'], ['time ls'], ['nohup sort a'], ['! grep a a']])(
    'negative: %s', (command) => {
      expectAllowed(command, { planRequired: true });
    },
  );
});

describe('Verification of B248: redirects, comments and PowerShell assignments around a writer', () => {
  it.each(TARGETS.flatMap((target) => [
    [`install a ${target.file} 2>&1`, target],
    [`install a ${target.file} > /dev/null`, target],
    [`cp a ${target.file} # note`, target],
    [`ln -sf a ${target.file}`, target],
    [`sort -uo ${target.file} a`, target],
    [`tar cf ${target.file} a`, target],
    [`git log -p --output=${target.file}`, target],
    [`git -C . config -f ${target.file} a.b c`, target],
  ] as const))('%s', (command, target) => {
    expectLikeRedirect(command, target);
  });

  it.each(TARGETS.flatMap((target) => [
    [`$w = [IO.StreamWriter]::new("${target.file}")`, target],
    [`$w = New-Object IO.StreamWriter ${target.file}`, target],
  ] as const))('PowerShell: %s', (command, target) => {
    expectLikeRedirect(command, target, 'PowerShell');
  });

  it('git format-patch -o writes into its folder', () => {
    expect(decide('git format-patch -o src HEAD~1', { planRequired: true })).toEqual({ decision: 'deny',
      rule: 'plan-gate' });
  });
});

describe('B248.W4: eval', () => {
  it.each(CASES(EVAL_WRITERS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });

  it('eval of a body with an unknown value is refused as a parse problem', () => {
    expect(decide('eval "$X"')).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([["eval 'rm \"$X\"'"], ["eval 'echo x > $X'"], ['eval rm \\$X']])(
    'a single-quoted or escaped body with an unknown value is refused too: %s', (command) => {
      expect(decide(command)).toEqual({ decision: 'deny', rule: 'shell-parse' });
    },
  );

  it.each(CASES(EVAL_WRITERS).map(([title, command, target, tool]) =>
    [`builtin ${title}`, `builtin ${command}`, target, tool] as const))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });

  it('negative: eval of a read', () => {
    expectAllowed("eval 'cat openspec/roles.yaml'");
  });
});

describe('B248.W5: PowerShell writers', () => {
  it.each(CASES(POWERSHELL_WRITERS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });
});

describe('Writers known before B248 stay known on every check', () => {
  it.each(CASES(OLD_WRITERS))('%s', (_title, command, target, tool) => {
    expectLikeRedirect(command, target, tool);
  });
});

describe('B248.W6: read forms of the same programs', () => {
  const STATE = 'openspec/roles.yaml';
  it.each([
    ['sort a'],
    [`sort ${STATE}`],
    ['curl http://example.test/x'],
    ['curl -o /dev/null http://example.test/x'],
    ['wget -O - http://example.test/x'],
    ['git show HEAD'],
    [`git show HEAD:${STATE}`],
    ['git diff'],
    [`git diff -- ${STATE}`],
    ['git config --get a.b'],
    ['git config -f openspec/sdlc.yaml --get a.b'],
    ['git config --file openspec/sdlc.yaml --list'],
    ['tar -tf a.tar'],
    ['tar -xf a.tar -O'],
    [`yq . ${STATE}`],
    [`patch --dry-run ${STATE} a`],
    [`stat ${STATE}`],
    [`chmod --help`],
    ['sort -o /dev/null a'],
  ])('%s', (command) => {
    expectAllowed(command);
    expectAllowed(command, { planRequired: true });
  });

  it.each([
    [`Get-Content ${STATE}`],
    [`Import-Csv ${STATE}`],
    [`[IO.File]::ReadAllText("${STATE}")`],
    [`Start-Process x -RedirectStandardInput ${STATE}`],
  ])('PowerShell: %s', (command) => {
    expectAllowed(command, {}, 'PowerShell');
  });
});

describe('No refusal is lost: a known writer adds targets, it never narrows the words checked', () => {
  const SOURCES = [['openspec/roles.yaml', 'state-integrity'], ['opencode.json', 'guard-config'],
    ['openspec/changes/fix/.sdlc.yaml', 'state-integrity']] as const;
  const FORMS: Array<[string, (file: string) => string]> = [
    ['cp out', (f) => `cp ${f} out.txt`],
    ['cp outside', (f) => `cp ${f} /tmp/out`],
    ['cp -t', (f) => `cp -t /tmp ${f}`],
    ['dd if=', (f) => `dd if=${f} of=out.txt`],
  ];
  it.each(SOURCES.flatMap(([file, rule]) => FORMS.map(([name, form]) => [`${name} of ${file}`, form(file), rule])))(
    '%s', (_title, command, rule) => {
      expect(decide(command, { testsLocked: true }), command).toEqual({ decision: 'deny', rule });
    },
  );

  it.each(SOURCES.map(([file, rule]) => [file, rule]))('Copy-Item of %s', (file, rule) => {
    const command = `Copy-Item ${file} out.txt`;
    expect(decide(command, { testsLocked: true }, 'PowerShell')).toEqual({ decision: 'deny', rule });
  });
});

describe('No target is invented (acceptance of card B248-2, replay of recorded commands)', () => {
  it.each([
    ['git rm --cached src/a.ts', 'Bash'],
    ['git rm -r -q --cached src', 'Bash'],
    ['Remove-Item (Join-Path $d $n)', 'PowerShell'],
    ['Remove-Item -Path (Join-Path $d "x") -Recurse', 'PowerShell'],
    ['Remove-Item -Recurse -Force (Join-Path $d $n)', 'PowerShell'],
    ['$p = Join-Path $d $n; Remove-Item -Recurse -Force $p', 'PowerShell'],
    ['$p = Get-Item x; Remove-Item $p', 'PowerShell'],
  ])('%s', (command, tool) => {
    expectAllowed(command, { planRequired: true }, tool);
  });

  it('a git rm of the file itself still counts', () => {
    expect(decide('git rm src/a.ts', { planRequired: true })).toEqual({ decision: 'deny', rule: 'plan-gate' });
  });
});

describe('B248.W7: outside the project', () => {
  it.each([
    ['touch /tmp/x'],
    ['curl -o /tmp/x http://example.test/x'],
    ['rm /tmp/x'],
    ['unlink /tmp/x'],
    ['install a /tmp/x'],
    ['sort -o ../out a'],
    ['echo x >| ../out'],
    ['git show --output=../out HEAD'],
  ])('%s', (command) => {
    expectAllowed(command, { planRequired: true });
  });
});

describe('Review round 1 of B248: eval with --', () => {
  it('F10: eval -- is followed into the body', () => {
    expect(decide('eval -- cp a src/a.test.ts', { testsLocked: true })).toEqual({ decision: 'deny',
      rule: 'tests-locked' });
    expect(decide('eval -- rm -rf src', { planRequired: true })).toEqual({ decision: 'deny', rule: 'plan-gate' });
  });
});
