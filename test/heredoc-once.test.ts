import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * OpenSpec change here-documents-are-parsed-once, as decided by the owner on 2026-11-14 after the independent review:
 * every line of a here-document body is read as a command by every check, the write check included. Reading a body as
 * data needs a parser as exact as bash; three rounds of a lexer still let bash run lines the hook took for data
 * (review F1). So:
 * - P7: a partly quoted delimiter (`<<'E'OF`) or a body bash runs no longer hides a write: closed;
 * - P6: an empty target keeps its refusal (B271) and the reason says the path is empty;
 * - P2: a harmless body can still be refused - a named limit; write such a file with the editor tool instead.
 * A project with an active change whose plan is not approved: a write into src/ is a plan-gate denial.
 */

const outside = path.join(os.tmpdir(), 'heredoc-once', 'x.md').replace(/\\/g, '/');
const CHANGE = 'openspec/changes/add-export';

function project() {
  const root = tempDir('heredoc-once-');
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: sdlc\n');
  write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const dir = path.join(root, CHANGE);
  write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
  writeChangeState(dir, newChangeState());
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.tools = ['claude', 'opencode'];
  return { root, config };
}

function bash(command: string) {
  const { root, config } = project();
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

const lines = (...parts: string[]) => parts.join('\n');

describe('P7 a here-document never hides a write', () => {
  it.each([`<<'E'OF`, '<<E"O"F', '<<"EOF"', `<<'EOF'`, '<<EOF', '<<-EOF'])(
    'P7.C1 the write after a here-document with %s meets the plan gate', (marker) => {
      expect(bash(lines(`cat ${marker}`, 'x', 'EOF', 'echo hi > src/evil.js'))).toMatchObject({ decision: 'deny' });
    });

  it('P7.C1 a line that only starts with the delimiter does not hide the next one', () => {
    const result = bash(lines(`cat > "${outside}" <<'EOF'`, 'EOF not yet', 'echo hi > src/evil.js', 'EOF'));
    expect(result.decision).toBe('deny');
  });

  it('P7.C2 a body that never closes is still read', () => {
    expect(bash(lines(`cat > "${outside}" <<'EOF'`, 'echo hi > src/evil.js')).decision).toBe('deny');
  });

  it.each(['bash', 'sh', 'node -', 'python3 -', "bash -s foo", 'bash /dev/stdin', 'source /dev/stdin', 'sed -f -'])(
    'P7.C3 a body read by %s is checked', (program) => {
      expect(bash(lines(`${program} <<'EOF'`, 'rm -rf src', 'EOF')).decision).toBe('deny');
    });

  it.each(["cat <<'EOF' | bash", "bash <<'A' <<'B'", "cat <<'EOF' | grep . | bash"])(
    'P7.C4 piped or several here-documents: %s', (head) => {
      expect(bash(lines(head, 'echo hi > src/evil.js', 'EOF', 'B')).decision).toBe('deny');
    });
});

describe('review F1: the shapes that hid a body from a lexer are refused', () => {
  const shapes: Array<[string, (line: string) => string]> = [
    ['a pipe into a subshell', (line) => lines("cat <<'EOF' | (sh)", line, 'EOF')],
    ['a pipe into a group', (line) => lines("cat <<'EOF' | { sh; }", line, 'EOF')],
    ['a pipe at the end of the line', (line) => lines("cat <<'EOF' |", line, 'EOF', 'sh')],
    ['a comment before the marker', (line) => lines('cat /dev/null # <<EOF', line, 'EOF')],
    ['a carriage return in the delimiter', (line) => `cat <<"EOF\r"\nEOF\r\n${line}\nEOF\r\r`],
    ['a backslash in the delimiter', (line) => lines('[ 1 ]; cat <<E\\OF', 'x', 'EOF', line, 'E\\OF')],
    ['a redefined reader', (line) => lines('cat() { bash; }', "cat <<'EOF'", line, 'EOF')],
  ];
  const targets: Array<[string, string, string]> = [
    ['a guard file', 'echo x > .claude/settings.json', 'guard-config'],
    ['a change state file', `echo x > ${CHANGE}/.sdlc.yaml`, 'state-integrity'],
    ['a code file before the plan', 'echo hi > src/evil.js', 'plan-gate'],
  ];
  for (const [shape, build] of shapes) {
    it.each(targets)(`${shape}: %s is refused`, (_name, line) => {
      expect(bash(build(line)).decision).toBe('deny');
    });
  }
});

describe('P2 named limit: a body is read as commands', () => {
  it('a harmless body with a backtick code span is refused, not run as data', () => {
    expect(bash(lines(`cat > "${outside}" <<'EOF'`, '| a | `node --test` | ok |', 'EOF')).decision).toBe('deny');
  });

  it('negative: a body of plain text is allowed', () => {
    expect(bash(lines(`cat > "${outside}" <<'EOF'`, '| a | node --test | ok |', 'EOF')).decision).toBe('allow');
  });
});

describe('apply_patch keeps its body as patch input (P2.C5)', () => {
  it('the patch files are the targets', () => {
    const patch = ['*** Begin Patch', '*** Add File: src/a.ts', '+export const a = 1;', '*** End Patch'];
    expect(bash(lines("apply_patch <<'EOF'", ...patch, 'EOF'))).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
  });
});

describe('a guard refusal names its file (P6)', () => {
  it('P6.C1 an empty target keeps its refusal, and the reason says the path is empty', () => {
    const result = bash(`rm '' 2>/dev/null; echo done > "${outside}"`);
    expect(result).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(result.reason ?? '').toMatch(/empty path|project root/i);
    expect(result.reason ?? '').not.toMatch(/^\s*configures/);
  });

  it('P6.C2 the guard-config reason contains the guarded file', () => {
    const result = bash('echo x > .opencode/plugins/sdlc.js');
    expect(result).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(result.reason ?? '').toContain('.opencode/plugins/sdlc.js');
  });

  it('review F3: a team rule of Claude Code is a guard file', () => {
    expect(bash('echo x > .claude/rules/people-decide-gates.md')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });
});
