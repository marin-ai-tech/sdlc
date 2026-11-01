const EVALUATION = new Set(['-e', '--eval', '-pe']);
const QUERY = new Set(['--version', '--help', '--check']);
const QUERY_ALIASES = new Map([['-v', '--version'], ['-h', '--help'], ['-c', '--check']]);
const VALUE = new Set([
  '--input-type', '--title', '-C', '--conditions', '--experimental-default-type', '--disable-proto',
  '--max-old-space-size', '--max-semi-space-size', '--stack-size', '--stack-trace-limit',
]);
const BOOLEAN = new Set([
  '--no-warnings', '--trace-warnings', '--trace-deprecation', '--no-deprecation', '--throw-deprecation',
  '--pending-deprecation', '--enable-source-maps', '--expose-gc', '--no-addons', '--experimental-wasm-modules',
  '--experimental-strip-types', '--no-experimental-strip-types', '--experimental-transform-types',
  '--test', '--watch', '--watch-preserve-output', '--inspect', '--inspect-brk', '-i', '--interactive',
]);
const PRELOAD = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--snapshot-blob',
  '--env-file', '--env-file-if-exists', '--experimental-config-file']);

export interface NodeLaunch {
  code?: string;
  scriptAt?: number;
  problem?: string;
  query?: boolean;
  codeAt?: number;
  optionsEnd?: number;
}

interface LaunchState extends NodeLaunch {
  uncertain: boolean;
  preload: boolean;
  queries: Set<string>;
}

export function nodeInlineOption(value: string): boolean {
  return EVALUATION.has(value) || value === '-p' || value === '--print'
    || value.startsWith('--eval=') || value.startsWith('--print=');
}

function evaluation(args: string[], index: number, state: LaunchState): number {
  const option = args[index];
  if (option.startsWith('--eval=')) {
    state.code = option.slice('--eval='.length);
    state.codeAt = index;
    return index;
  }
  const next = args[index + 1];
  if (next !== undefined && !next.startsWith('-')) {
    state.code = next;
    state.codeAt = index + 1;
    return index + 1;
  }
  if (EVALUATION.has(option)) state.problem ??= 'Missing or unclassified inline Node program.';
  return index;
}

function option(args: string[], index: number, state: LaunchState): number {
  const value = args[index];
  const name = value.split('=', 1)[0];
  const query = QUERY_ALIASES.get(name) ?? name;
  const cancelled = name.startsWith('--no-') ? `--${name.slice('--no-'.length)}` : '';
  if (QUERY.has(query)) state.queries.add(query);
  else if (QUERY.has(cancelled)) state.queries.delete(cancelled);
  else if (VALUE.has(name) || PRELOAD.has(name)) {
    state.preload ||= PRELOAD.has(name);
    if (!value.includes('=')) {
      if (args[index + 1] === undefined) state.problem ??= 'Missing Node option value.';
      else return index + 1;
    }
  } else if (!BOOLEAN.has(name)) state.uncertain = true;
  return index;
}

/** Native Node options end before the entry script or first application operand, never inside its data. */
export function nodeLaunch(args: string[]): NodeLaunch {
  const state: LaunchState = { uncertain: false, preload: false, queries: new Set(), optionsEnd: args.length - 1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') {
      state.optionsEnd = i;
      if (state.code === undefined && args[i + 1] !== undefined) state.scriptAt = i + 1;
      break;
    }
    if (!args[i].startsWith('-') || args[i] === '-') {
      state.optionsEnd = i;
      if (state.code === undefined) state.scriptAt = i;
      if (state.uncertain && args.slice(i + 1).some(nodeInlineOption)) state.problem ??= 'Unclassified Node launch mode.';
      break;
    }
    if (nodeInlineOption(args[i])) i = evaluation(args, i, state);
    else i = option(args, i, state);
  }
  return launchResult(state);
}

function launchResult(state: LaunchState): NodeLaunch {
  if (state.queries.size && !state.uncertain) {
    return { query: true, codeAt: state.codeAt, optionsEnd: state.optionsEnd };
  }
  if (state.queries.size && state.uncertain) state.problem ??= 'Cannot statically resolve the Node query mode.';
  if (state.code !== undefined && (state.uncertain || state.preload)) {
    state.problem ??= 'Cannot statically resolve inline Node options or preloaded code.';
  }
  const { uncertain: _uncertain, preload: _preload, queries: _queries, ...result } = state;
  return result;
}

export function nodeInlineCode(args: string[]): string | undefined {
  return nodeLaunch(args).code;
}
