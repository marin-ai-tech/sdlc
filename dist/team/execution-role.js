const WORKFLOW_ROLE = {
    explore: 'analyst', intent: 'analyst', spec: 'analyst', plan: 'developer', build: 'developer',
    verify: 'tester', review: 'reviewer', release: 'developer', archive: 'analyst', triage: 'analyst',
    backlog: 'analyst', team: 'architect', adopt: 'architect',
};
/** Pure guidance; no rendering, trust loading, human roles or lifecycle imports. */
export function roleForWorkflow(config, workflow) {
    return config.team?.mode === 'solo' ? WORKFLOW_ROLE[workflow] : undefined;
}
