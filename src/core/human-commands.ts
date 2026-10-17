export const HUMAN_COMMANDS = [
  'approve', 'reject', 'rework', 'waive', 'drop', 'tests unlock', 'track set',
  'backlog move', 'backlog drop', 'license set', 'roles migrate', 'takeover', 'release-control',
  // Removing the harness switches the guard off: a person's decision (B41).
  'uninstall',
  // What a role of the agent team says is a person's decision (B72).
  'team accept',
  // An answer to an open question is a person's decision (B62).
  'answer',
  // CI configuration (often a protected path) and the ci-green gate are a person's decision (B94).
  'ci init',
  // Issuing an executor's token is a person's decision (B118): the token is an identity, not a config value.
  'task executors token',
] as const;
