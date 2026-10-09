export const HUMAN_COMMANDS = [
  'approve', 'reject', 'rework', 'waive', 'tests unlock', 'track set',
  'backlog move', 'backlog drop', 'license set', 'roles migrate', 'takeover', 'release-control',
  // Removing the harness switches the guard off: a person's decision (B41).
  'uninstall',
  // What a role of the agent team says is a person's decision (B72).
  'team accept',
  // An answer to an open question is a person's decision (B62).
  'answer',
] as const;
