/**
 * The state files only the harness may write, root-relative (B115): the one list the policy modules and the task
 * contract share. A change's `.sdlc.yaml` sits inside its change folder; callers add the folders on disk.
 */
export const STATE_FILES = [
  'openspec/backlog.md', 'openspec/roles.yaml', 'openspec/.sdlc/log.jsonl', 'openspec/.sdlc/team.json',
];
