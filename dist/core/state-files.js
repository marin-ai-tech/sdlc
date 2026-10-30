/**
 * The state files only the harness may write, root-relative (B115): the one list the policy modules and the task
 * contract share. A change's `.sdlc.yaml` sits inside its change folder; callers add the folders on disk.
 */
export const STATE_FILES = [
    'openspec/.sdlc/plugins/**',
    'openspec/backlog.md', 'openspec/roles.yaml', 'openspec/executors.yaml', 'openspec/.sdlc/log.jsonl',
    'openspec/.sdlc/hook-log.jsonl', 'openspec/.sdlc/log.lock',
    'openspec/.sdlc/team.json', 'openspec/.sdlc/board.json', 'openspec/.sdlc/board.lock',
];
