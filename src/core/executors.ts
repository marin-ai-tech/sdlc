import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { CHANGE_KINDS, RISK_LEVELS, type ChangeKind, type RiskLevel } from './change-state.js';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';
import { parse, parseDocument } from 'yaml';

/**
 * The executor registry `openspec/executors.yaml` (B116, epic E16): a person lists the executors - swarms of any
 * type - and the highest risk and kinds of change each may take. `sdlc task export` hands work only to an executor
 * allowed for the change; `sdlc task check-result` wants every commit's `SDLC-Agent` trailer to name one.
 * The registry is a state file: agents cannot edit it. This module only parses it at the boundary; the swarm
 * logic (boards, leases, markets) stays outside sdlc.
 */
export const EXECUTORS_PATH = 'openspec/executors.yaml';

export const EXECUTOR_TYPES = ['representative', 'board', 'market', 'mesh'] as const;
export type ExecutorType = (typeof EXECUTOR_TYPES)[number];

const EXECUTOR_ID_PATTERN = '[a-z0-9][a-z0-9._-]{0,63}';
const AGENT_NAME_PATTERN = '[A-Za-z0-9._-]{1,64}';
/** `id` of an executor; also the `<executor>` half of the `SDLC-Agent` trailer. */
export const EXECUTOR_ID = new RegExp(`^${EXECUTOR_ID_PATTERN}$`);
/** The `<agent>` half of the `SDLC-Agent` trailer an executor writes on its commits. */
export const AGENT_NAME = new RegExp(`^${AGENT_NAME_PATTERN}$`);
/** The value a commit's first `SDLC-Agent` trailer must carry: `<executor>/<agent>`, both groups captured. */
export const AGENT_TRAILER = new RegExp(`^(${EXECUTOR_ID_PATTERN})/(${AGENT_NAME_PATTERN})$`);

const KNOWN_FIELDS = new Set(['type', 'name', 'max_risk', 'kinds', 'capabilities', 'token_sha256']);

/** `token_sha256`: the SHA-256 of the executor's token, 64 lowercase hex characters; the token itself is never kept. */
const TOKEN_SHA256 = /^[0-9a-f]{64}$/;

export interface Executor {
  id: string;
  type: ExecutorType;
  name?: string;
  maxRisk: RiskLevel;
  kinds?: ChangeKind[];
  capabilities: string[];
  /** The SHA-256 of the executor's token (`token_sha256` in the file); `sdlc mcp serve --http` accepts it. */
  tokenSha256?: string;
}

function invalid(file: string, field: string, detail: string): never {
  throw new SdlcError('executors_invalid', { key: 'error.x_x_x_2', params: { file, field, detail } });
}

function strings(value: unknown, file: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    invalid(file, field, 'must be a list of nonempty strings');
  }
  return value as string[];
}

function executorOf(id: string, value: unknown, file: string): Executor {
  if (!EXECUTOR_ID.test(id)) invalid(file, `executors.${id}`, `id ${id} must match ${EXECUTOR_ID}`);
  const field = (name: string) => `executors.${id}.${name}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(file, `executors.${id}`, 'must be a mapping');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.has(key)) invalid(file, field(key), `unknown field ${key}`);
  }
  if (!EXECUTOR_TYPES.includes(raw.type as ExecutorType)) {
    invalid(file, field('type'), `must be ${EXECUTOR_TYPES.join(' | ')}`);
  }
  if (!RISK_LEVELS.includes(raw.max_risk as RiskLevel)) {
    invalid(file, field('max_risk'), `required: ${RISK_LEVELS.join(' | ')}`);
  }
  if (raw.name !== undefined && typeof raw.name !== 'string') invalid(file, field('name'), 'must be a string');
  const kinds = raw.kinds === undefined ? undefined : strings(raw.kinds, file, field('kinds'));
  for (const kind of kinds ?? []) {
    if (!CHANGE_KINDS.includes(kind as ChangeKind)) invalid(file, field('kinds'), `unknown change kind ${kind}`);
  }
  if (raw.token_sha256 !== undefined && (typeof raw.token_sha256 !== 'string' || !TOKEN_SHA256.test(raw.token_sha256))) {
    invalid(file, field('token_sha256'), 'must be the SHA-256 of the token: 64 lowercase hex characters');
  }
  return {
    id,
    type: raw.type as ExecutorType,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    maxRisk: raw.max_risk as RiskLevel,
    ...(kinds ? { kinds: kinds as ChangeKind[] } : {}),
    capabilities: raw.capabilities === undefined ? [] : strings(raw.capabilities, file, field('capabilities')),
    ...(typeof raw.token_sha256 === 'string' ? { tokenSha256: raw.token_sha256 } : {}),
  };
}

/**
 * Reads `openspec/executors.yaml` into typed records; `undefined` when the file does not exist (everything works
 * as without the feature). Any structural problem is `executors_invalid`, naming the executor id and the field.
 */
export function readExecutors(root: string): Map<string, Executor> | undefined {
  const file = path.join(root, EXECUTORS_PATH);
  const text = readText(file);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    invalid(EXECUTORS_PATH, 'yaml', error instanceof Error ? error.message : String(error));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid(EXECUTORS_PATH, 'root', 'must be a mapping');
  }
  const table = (parsed as Record<string, unknown>).executors;
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    invalid(EXECUTORS_PATH, 'executors', 'must be a mapping of executor id to its definition');
  }
  const registry = new Map<string, Executor>();
  for (const [id, value] of Object.entries(table as Record<string, unknown>)) {
    registry.set(id, executorOf(id, value, EXECUTORS_PATH));
  }
  return registry;
}

/**
 * `sdlc task executors token <id>` (B118, epic E16): a person issues the executor a new token. 256 random bits as
 * base64url (43 characters) are returned once; only the SHA-256 goes into `token_sha256` of that executor, through
 * the yaml Document API so comments, the order and the other executors stay as they were. A new token replaces the
 * old hash, so the old token stops working at once. The token never lands in the file, the log or an error.
 */
export function issueExecutorToken(root: string, id: string): { executor: Executor; token: string } {
  const file = path.join(root, EXECUTORS_PATH);
  const text = readText(file);
  if (text === undefined) throw new SdlcError('no_executor_registry', { key: 'error.no_executor_registry' });
  const registry = readExecutors(root);
  const executor = registry?.get(id);
  if (!executor) {
    throw new SdlcError(
      'unknown_executor',
      { key: 'error.x_is_not_an_executor_of_x', params: { executor: id, file: EXECUTORS_PATH } },
    );
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const digest = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const doc = parseDocument(text);
  doc.setIn(['executors', id, 'token_sha256'], digest);
  writeTextAtomic(file, doc.toString({ lineWidth: 0 }));
  return { executor, token };
}

/**
 * May `executor` take a change of this risk and kind? `undefined` when yes, else a one-line reason naming the
 * executor's limit and the change's risk or kind. One rule for export and check-result: risk order
 * low < medium < high, the change's risk at most `maxRisk`, and no `kinds` or the kind is in them.
 */
export function executorRefusal(executor: Executor, risk: string, kind: string): string | undefined {
  if (RISK_LEVELS.indexOf(risk as RiskLevel) > RISK_LEVELS.indexOf(executor.maxRisk)) {
    return `risk ${risk} exceeds max_risk ${executor.maxRisk} of ${executor.id}`;
  }
  if (executor.kinds && !executor.kinds.includes(kind as ChangeKind)) {
    return `kind ${kind} is not in kinds ${executor.kinds.join(', ')} of ${executor.id}`;
  }
  return undefined;
}
