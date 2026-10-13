import type { GateId } from './config.js';

/**
 * The six stages of Anthropic's AI-native SDLC playbook, plus the two terminal
 * states a change can be in. A change's stage is derived from its artifacts
 * and gate records every time; nothing stores "current stage", so a hand edit
 * or a git revert can never leave the recorded stage out of sync.
 */
export const STAGES = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'] as const;
export type StageId = (typeof STAGES)[number] | 'done' | 'archived';

export const STAGE_TITLES: Record<StageId, string> = {
  plan: 'Plan (intent)',
  design: 'Design (requirements + design spec)',
  build: 'Build (plan + implementation)',
  test: 'Test (verification evidence)',
  deploy: 'Deploy (review + release)',
  maintain: 'Maintain (close the loop)',
  done: 'Done (ready to archive)',
  archived: 'Archived',
};

export const GATE_STAGE: Record<GateId, StageId> = {
  intent: 'plan',
  spec: 'design',
  plan: 'build',
  verify: 'test',
  qa: 'test',
  review: 'deploy',
  release: 'deploy',
};
