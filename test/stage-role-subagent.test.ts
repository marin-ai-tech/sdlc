import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { stageResources, stageSection } from '../src/integrations/stage-resources.js';
import type { RoleFile } from '../src/team/role-file.js';

// B257 (plan openspec/explorations/b337-b338-b257-b249-plan.md, owner's answer 2 of 2026-11-25). In team mode a
// stage that has an accepted role subagent tells the main agent to hand the stage work to it, or to say in its
// final report why it did the work itself. On the OpenCode stand (2026-11-24/25) the main agent never called the
// analyst or the developer; only the subagents a workflow demands were called (simplifier, tester, reviewer).
// Review round 1 (F1, F2): the read-only roles (tester, reviewer) check and never write; verify and review already
// hand them the checking in their own steps, and release has only the reviewer on its stage. So only roles that
// may write get the hand-off line, and the line says the main agent keeps the questions and the gate (F4).

function role(id: string, stages: RoleFile['stages'], readonly: boolean, skills: string[] = []): RoleFile {
  return { id, title: id, description: `Role ${id}`, stages, tools: ['read'], readonly, body: `# ${id}\n`, skills };
}

/** The built-in team: stages and read-only flags as in assets/roles/en. */
const BUILT_IN = [
  role('analyst', ['plan', 'design'], false, ['plan-mode']),
  role('architect', ['design'], false),
  role('developer', ['build'], false, ['bug-fix-protocol']),
  role('tester', ['test'], true, ['bug-fix-protocol']),
  role('reviewer', ['deploy'], true, ['code-that-fits-in-your-head']),
];
const TEAM = BUILT_IN.filter((r) => r.id === 'analyst' || r.id === 'developer');

function section(workflow: string, team: readonly RoleFile[], mode?: 'team' | 'solo', inject = true) {
  const config = defaultConfig();
  if (mode) config.team = { mode } as NonNullable<typeof config.team>;
  return stageSection(stageResources(config, workflow, team), { inject });
}

const HAND_OFF = /hand the stage work to the role subagent/i;

describe('B257.C1 the hand-off step in team mode', () => {
  it('build names sdlc-developer and the report line about doing it yourself', () => {
    const text = section('build', TEAM, 'team');
    expect(text).toMatch(HAND_OFF);
    expect(text).toMatch(/hand the stage work[^\n]*`sdlc-developer`/i);
    expect(text).toMatch(/final report[^\n]*why[^\n]*(yourself|main agent)/i);
  });

  it('the line is for the main agent, which keeps the questions to the person and the gate', () => {
    const line = section('build', TEAM, 'team').split('\n').find((l) => HAND_OFF.test(l)) ?? '';
    expect(line).toMatch(/main agent/i);
    expect(line).toMatch(/question/i);
    expect(line).toMatch(/gate/i);
  });

  it('it comes right after the subagent list, also on surfaces without injected skills', () => {
    for (const inject of [true, false]) {
      const lines = section('build', TEAM, 'team', inject).split('\n');
      const at = lines.findIndex((l) => l.startsWith('- Subagents for this stage:'));
      expect(at, `inject ${inject}`).toBeGreaterThan(0);
      expect(lines[at + 1], `inject ${inject}`).toMatch(HAND_OFF);
    }
  });

  it('spec and intent name sdlc-analyst; review has no role subagent here and gets no hand-off', () => {
    expect(section('spec', TEAM, 'team')).toMatch(/hand the stage work[^\n]*`sdlc-analyst`/i);
    expect(section('intent', TEAM, 'team')).toMatch(/hand the stage work[^\n]*`sdlc-analyst`/i);
    expect(section('review', TEAM, 'team')).not.toMatch(HAND_OFF);
  });

  it('two writing roles on one stage: each part goes to the role that fits it', () => {
    const text = section('spec', BUILT_IN, 'team');
    expect(text).toMatch(/`sdlc-analyst`[^\n]*`sdlc-architect`/);
    expect(text).toMatch(/fits each part/i);
  });

  it('a team without a mode set still gets the step when a role subagent exists', () => {
    expect(section('build', TEAM)).toMatch(/hand the stage work[^\n]*`sdlc-developer`/i);
  });
});

describe('B257.C2 negative: no new step where there is nothing to hand off', () => {
  it('solo mode gets no hand-off step', () => {
    expect(section('build', [], 'solo')).not.toMatch(HAND_OFF);
  });

  it('the simplifier alone is not a role subagent', () => {
    const text = section('build', [], 'team');
    expect(text).toContain('sdlc-simplifier');
    expect(text).not.toMatch(HAND_OFF);
  });

  it('a stage without skills or subagents renders nothing, as before', () => {
    expect(section('verify', TEAM, 'team')).toBe('');
  });

  it('review F1, F2: the read-only tester and reviewer get no hand-off in verify, review or release', () => {
    for (const workflow of ['verify', 'review', 'release']) {
      const text = section(workflow, BUILT_IN, 'team');
      expect(text, workflow).toMatch(/Subagents for this stage/);
      expect(text, workflow).not.toMatch(HAND_OFF);
    }
  });

  it('review F6: a role named like the simplifier is not handed the build', () => {
    const text = section('build', [role('simplifier', ['build'], false)], 'team');
    expect(text).not.toMatch(/hand the stage work[^\n]*`sdlc-simplifier`/i);
  });
});
