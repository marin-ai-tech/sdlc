/**
 * The tools of `sdlc mcp serve` (B13). Each one is a read-only CLI command run with `--json`; the server never
 * offers a decision (approve, reject, waive, rework, takeover, release-control, tests unlock, license set,
 * backlog move or drop, adopt --apply, uninstall). Input schemas are plain JSON Schema.
 */

/** A JSON Schema object with string properties only: every tool argument is a word passed to the CLI. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: 'string'; description: string }>;
  required?: string[];
  additionalProperties: false;
}

export interface ReadTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** The CLI arguments (without `--json`) for checked tool arguments. */
  argv: (args: Record<string, string | undefined>) => string[];
}

function schema(properties: Record<string, string>, required: string[] = []): ToolInputSchema {
  const props: ToolInputSchema['properties'] = {};
  for (const [name, description] of Object.entries(properties)) props[name] = { type: 'string', description };
  return { type: 'object', properties: props, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** `--change <id>` when a change is given. */
function changeOption(change: string | undefined): string[] {
  return change === undefined ? [] : ['--change', change];
}

const CHANGE = 'change id (defaults to the only active change)';

export const READ_TOOLS: readonly ReadTool[] = [
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
];

export function findTool(name: string): ReadTool | undefined {
  return READ_TOOLS.find((tool) => tool.name === name);
}

/**
 * The tool arguments as CLI words, or the reason they are refused: only the declared properties, strings, the
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
    if (typeof value !== 'string') return `${key} must be a string`;
    if (value.trim() === '' || value.startsWith('-') || /[\0\r\n]/.test(value)) return `${key} is not a valid value`;
    out[key] = value;
  }
  const missing = (tool.inputSchema.required ?? []).filter((key) => out[key] === undefined);
  return missing.length ? `missing argument: ${missing.join(', ')}` : out;
}
