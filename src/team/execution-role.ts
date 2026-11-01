import type { SdlcConfig } from '../core/config.js';

export type ExecutionRole = (typeof import('./sources.js').BUILTIN_ROLE_IDS)[number];

const WORKFLOW_ROLE: Readonly<Record<string, ExecutionRole>> = {
  explore: 'analyst', intent: 'analyst', spec: 'analyst', plan: 'developer', build: 'developer',
  verify: 'tester', review: 'reviewer', release: 'developer', archive: 'analyst', triage: 'analyst',
  backlog: 'analyst', team: 'architect', adopt: 'architect',
};

/** Pure guidance; no rendering, trust loading, human roles or lifecycle imports. */
export function roleForWorkflow(config: Pick<SdlcConfig, 'team'>, workflow: string): ExecutionRole | undefined {
  return config.team?.mode === 'solo' ? WORKFLOW_ROLE[workflow] : undefined;
}
