/**
 * `gates.<g>.judge` (B19): an independent model checks the gate's artifacts by a rubric before a person approves.
 * Parsed here; config.ts only calls `parseJudgeConfig` and stores the field. Shape: `{ run }` or `{ server, tool }`,
 * plus required `rubric` (a project file) and optional `max_loops` (default 3).
 */
import { SdlcError } from './errors.js';

export const DEFAULT_JUDGE_LOOPS = 3;

export interface JudgeCommandConfig {
  kind: 'command';
  run: string;
  rubric: string;
  maxLoops: number;
}

export interface JudgeMcpConfig {
  kind: 'mcp';
  server: string;
  tool: string;
  rubric: string;
  maxLoops: number;
}

export type JudgeConfig = JudgeCommandConfig | JudgeMcpConfig;

const KEYS = ['run', 'server', 'tool', 'rubric', 'max_loops'];

function invalid(key: string, where: string, params: Record<string, string | number> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...params } });
}

function asString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('error.x_must_be_a_non_empty_string', where);
  }
  return value.trim();
}

function asLoops(value: unknown, where: string): number {
  if (value === undefined || value === null) return DEFAULT_JUDGE_LOOPS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid('error.x_must_be_a_positive_number', where);
  }
  return value;
}

/** `gates.<g>.judge`: absent = undefined (no judge). */
export function parseJudgeConfig(value: unknown, where: string): JudgeConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('error.x_must_be_a_mapping', where);
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).find((key) => !KEYS.includes(key));
  if (unknown !== undefined) throw invalid('error.judge_unknown_key', `${where}.${unknown}`);
  const rubric = asString(raw.rubric, `${where}.rubric`);
  if (!rubric) throw invalid('error.x_is_required', `${where}.rubric`);
  const maxLoops = asLoops(raw.max_loops, `${where}.max_loops`);
  const run = asString(raw.run, `${where}.run`);
  const server = asString(raw.server, `${where}.server`);
  const tool = asString(raw.tool, `${where}.tool`);
  if (run && (server || tool)) throw invalid('error.judge_run_or_mcp', where);
  if (run) return { kind: 'command', run, rubric, maxLoops };
  if (server && tool) return { kind: 'mcp', server, tool, rubric, maxLoops };
  if (server || tool) throw invalid('error.judge_mcp_pair', where);
  throw invalid('error.judge_run_or_mcp', where);
}

/** On-disk shape for `serializeConfig` (snake_case, no `kind`). */
export function serializeJudgeConfig(judge: JudgeConfig): Record<string, unknown> {
  const base = {
    rubric: judge.rubric,
    ...(judge.maxLoops !== DEFAULT_JUDGE_LOOPS ? { max_loops: judge.maxLoops } : {}),
  };
  if (judge.kind === 'command') return { run: judge.run, ...base };
  return { server: judge.server, tool: judge.tool, ...base };
}