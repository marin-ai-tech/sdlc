/**
 * The tools of `sdlc mcp serve`. Each runs a CLI command with `--json`; the server never
 * offers a decision (approve, reject, waive, rework, takeover, release-control, tests unlock, license set,
 * backlog move or drop, adopt --apply, uninstall). Input schemas are plain JSON Schema.
 */

/** Tool arguments become CLI words after type checking. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: 'string' | ['string', 'number'] | 'object'; description: string;
    [key: string]: unknown }>;
  required?: string[];
  additionalProperties: false;
}

export interface ReadTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** The CLI arguments (without `--json`) for checked tool arguments. */
  argv: (args: Record<string, string | undefined>) => string[];
  /** Structured extensions take their own JSON boundary, never the scalar CLI word converter. */
  extensions?: boolean;
}

function withExtensions(input: ToolInputSchema): ToolInputSchema {
  return { ...input, properties: { ...input.properties, ext: { type: 'object',
    description: 'Plugin-namespaced contract extensions; values preserve JSON types',
    propertyNames: { pattern: '^[a-z][a-z0-9-]{0,23}$',
      not: { enum: ['project', 'executor', 'origin', 'request', 'constructor', 'prototype'] } },
    additionalProperties: true } } };
}

function schema(properties: Record<string, string>, required: string[] = []): ToolInputSchema {
  const props: ToolInputSchema['properties'] = {};
  for (const [name, description] of Object.entries(properties)) props[name] = { type: 'string', description };
  return { type: 'object', properties: props, ...(required.length ? { required } : {}), additionalProperties: false };
}

function numericSchema(properties: Record<string, string>, numeric: string[], required: string[]): ToolInputSchema {
  const input = schema(properties, required);
  for (const name of numeric) input.properties[name].type = ['string', 'number'];
  return input;
}

/** `--change <id>` when a change is given. */
function changeOption(change: string | undefined): string[] {
  return change === undefined ? [] : ['--change', change];
}

function requestOption(request: string | undefined): string[] {
  return request === undefined ? [] : ['--request', request];
}

const CHANGE = 'change id (defaults to the only active change)';

export const READ_TOOLS: readonly ReadTool[] = [
  {
    name: 'task_export',
    description: 'Export the task contract of an approved change, with optional plugin extensions.',
    inputSchema: withExtensions(schema({ change: CHANGE, task: 'task number', executor: 'target executor id' })),
    extensions: true,
    argv: (a) => ['task', 'export', ...changeOption(a.change),
      ...(a.task === undefined ? [] : ['--task', a.task]),
      ...(a.executor === undefined ? [] : ['--executor', a.executor])],
  },
  {
    name: 'board_list',
    description: 'List tasks on the board and their current state.',
    inputSchema: schema({ change: CHANGE }),
    argv: (a) => ['board', 'list', ...changeOption(a.change)],
  },
  {
    name: 'status',
    description: 'What `sdlc status --json` prints: every change, or one change in detail.',
    inputSchema: schema({ change: 'change id; omit for every change' }),
    argv: (a) => ['status', ...changeOption(a.change)],
  },
  {
    name: 'next',
    description: 'What `sdlc next --json` prints: the next step of a change and who acts.',
    inputSchema: schema({ change: CHANGE }),
    argv: (a) => ['next', ...changeOption(a.change)],
  },
  {
    name: 'instructions',
    description: 'What `sdlc instructions <artifact> --change <id> --json` prints: how to write an artifact.',
    inputSchema: schema(
      { artifact: 'artifact id, e.g. intent, plan, tasks', change: 'change id' },
      ['artifact', 'change'],
    ),
    argv: (a) => ['instructions', a.artifact ?? '', ...changeOption(a.change)],
  },
  {
    name: 'trace',
    description: 'What `sdlc trace <change> --json` prints: requirements to tasks, tests and evidence.',
    inputSchema: schema({ change: 'change id' }, ['change']),
    argv: (a) => ['trace', a.change ?? ''],
  },
  {
    name: 'audit',
    description: 'What `sdlc audit --json` prints: the decision record of the changes.',
    inputSchema: schema({ change: 'change id (active or archived); omit for every change' }),
    argv: (a) => ['audit', ...changeOption(a.change)],
  },
  {
    name: 'help',
    description: 'What `sdlc help [topic] --json` prints: the workflows and commands, or one topic.',
    inputSchema: schema({ topic: 'help topic; omit for the catalog' }),
    argv: (a) => ['help', ...(a.topic === undefined ? [] : [a.topic])],
  },
  {
    name: 'guide',
    description: 'What `sdlc guide [topic] --json` prints: how sdlc works - the topics, an article or a section.',
    inputSchema: schema({ topic: 'guide topic, or topic#section (e.g. denials#plan-gate); omit for the index' }),
    argv: (a) => ['guide', ...(a.topic === undefined ? [] : [a.topic])],
  },
  {
    name: 'explain',
    description: 'What `sdlc explain --json` prints: why a change is where it is and what unblocks it.',
    inputSchema: schema({ change: CHANGE }),
    argv: (a) => ['explain', ...changeOption(a.change)],
  },
  {
    name: 'health',
    description: 'What `sdlc health --json` prints: advice about the project over a time window.',
    inputSchema: schema({
      since: 'from this date on instead of health.window_days',
      days: 'look at the last n days instead of health.window_days',
    }),
    argv: (a) => [
      'health',
      ...(a.since === undefined ? [] : ['--since', a.since]),
      ...(a.days === undefined ? [] : ['--days', a.days]),
    ],
  },
  {
    name: 'report',
    description: 'What `sdlc report --format json` prints: the project report for a period or one change.',
    inputSchema: schema({
      since: 'period start',
      change: 'one change',
    }),
    argv: (a) => [
      'report',
      '--format',
      'json',
      ...(a.since === undefined ? [] : ['--since', a.since]),
      ...changeOption(a.change),
    ],
  },
];

export const WRITE_TOOLS: readonly ReadTool[] = [
  {
    name: 'board_claim',
    description: 'Claim a board task as the token executor.',
    inputSchema: withExtensions(numericSchema({ change: CHANGE, task: 'task number', agent: 'agent name',
      lease: 'lease in seconds', request: 'idempotency key' }, ['lease'], ['change', 'task', 'agent'])),
    extensions: true,
    argv: (a) => ['board', 'claim', '--change', a.change ?? '', '--task', a.task ?? '',
      '--agent', a.agent ?? '', ...(a.lease ? ['--lease', a.lease] : []), ...requestOption(a.request)],
  },
  {
    name: 'board_heartbeat',
    description: 'Extend a claim lease.',
    inputSchema: schema({ claim: 'secret claim id', request: 'idempotency key' }, ['claim']),
    argv: (a) => ['board', 'heartbeat', '--claim', a.claim ?? '', ...requestOption(a.request)],
  },
  {
    name: 'board_release',
    description: 'Release a claim to the board.',
    inputSchema: schema({ claim: 'secret claim id', note: 'release note', request: 'idempotency key' }, ['claim']),
    argv: (a) => ['board', 'release', '--claim', a.claim ?? '',
      ...(a.note ? ['--note', a.note] : []), ...requestOption(a.request)],
  },
  {
    name: 'board_submit',
    description: 'Submit a claim result branch.',
    inputSchema: schema({ claim: 'secret claim id', branch: 'result branch',
      base: 'base ref', request: 'idempotency key' }, ['claim', 'branch']),
    argv: (a) => ['board', 'submit', '--claim', a.claim ?? '', '--branch', a.branch ?? '',
      ...(a.base ? ['--base', a.base] : []), ...requestOption(a.request)],
  },
  {
    name: 'board_bid',
    description: 'Bid for an open auction as the token executor.',
    inputSchema: withExtensions(numericSchema({ change: CHANGE, task: 'task number', agent: 'agent name',
      minutes: 'estimated minutes', cost: 'estimated cost', note: 'bid note',
      request: 'idempotency key' }, ['minutes', 'cost'], ['change', 'task', 'agent', 'minutes'])),
    extensions: true,
    argv: (a) => ['board', 'bid', '--change', a.change ?? '', '--task', a.task ?? '',
      '--agent', a.agent ?? '', '--minutes', a.minutes ?? '',
      ...(a.cost === undefined ? [] : ['--cost', a.cost]),
      ...(a.note === undefined ? [] : ['--note', a.note]), ...requestOption(a.request)],
  },
];

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.some((tool) => tool.name === name);
}

export function findTool(name: string): ReadTool | undefined {
  return [...READ_TOOLS, ...WRITE_TOOLS].find((tool) => tool.name === name);
}

/**
 * The tool arguments as CLI words, or the reason they are refused: only the declared properties and types, the
 * required ones present, and no value that the CLI would read as an option (a leading `-`) or that is empty.
 */
export function checkArguments(tool: ReadTool, input: unknown): Record<string, string | undefined> | string {
  const args = input === undefined || input === null ? {} : input;
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const known = tool.inputSchema.properties;
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (!(key in known)) return `unknown argument: ${key}`;
    if (value === undefined || value === null) continue;
    if (known[key].type === 'object') return `${key} requires structured argument validation`;
    const numeric = Array.isArray(known[key].type);
    if (typeof value !== 'string' && !(numeric && typeof value === 'number' && Number.isFinite(value))) {
      return `${key} must be ${numeric ? 'a string or number' : 'a string'}`;
    }
    const word = String(value);
    if (word.trim() === '' || word.startsWith('-') || /[\0\r\n]/.test(word)) return `${key} is not a valid value`;
    out[key] = word;
  }
  const missing = (tool.inputSchema.required ?? []).filter((key) => out[key] === undefined);
  return missing.length ? `missing argument: ${missing.join(', ')}` : out;
}
