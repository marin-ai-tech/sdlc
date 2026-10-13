/**
 * The judge gate (B19): before a person approves a planning gate, an independent model checks the artifacts by a
 * rubric. `sdlc judge` runs the configured command or MCP tool, records the verdict bound to the artifact digest, and
 * blocks approval until a passing verdict for the current digest — or until `max_loops` failing verdicts (across
 * versions) hand the decision to a person. The judge never approves.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { ChangeState, GateState } from './change-state.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { isFile, isWithin, readText } from './fs-utils.js';
import { t, type MessageParams } from './i18n.js';
import type { JudgeConfig } from './judge-config.js';
import { lr, type LocalizedReason } from './approval-gate.js';
import type { LifecycleView, NextAction } from './lifecycle.js';
import { callServerTool } from '../mcp/client.js';

/** One recorded verdict, bound to the digest of the gate's artifacts at the time it ran. */
export interface JudgeVerdictRecord {
  pass: boolean;
  route: string;
  rework: string;
  digest: string;
  at: string;
}

export interface JudgeRequest {
  change: string;
  gate: string;
  rubric: string;
  artifacts: Array<{ path: string; content: string }>;
}

export interface JudgeVerdict {
  pass: boolean;
  route: string;
  rework: string;
}

export const JUDGE_TIMEOUT_MS = 60_000;

function gateJudge(config: SdlcConfig, gate: ApprovalGateId): JudgeConfig | undefined {
  return config.gates[gate]?.judge;
}

/** Verdicts recorded for the gate (oldest first); empty when none. */
export function judgeVerdicts(state: ChangeState, gate: ApprovalGateId): JudgeVerdictRecord[] {
  const raw = state.gates[gate]?.judge;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isVerdictRecord);
}

function isVerdictRecord(value: unknown): value is JudgeVerdictRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.pass === 'boolean'
    && typeof row.route === 'string'
    && typeof row.rework === 'string'
    && typeof row.digest === 'string'
    && typeof row.at === 'string';
}

/** Failing verdicts for the gate across every artifact version. */
export function failingJudgeCount(state: ChangeState, gate: ApprovalGateId): number {
  return judgeVerdicts(state, gate).filter((row) => row.pass === false).length;
}

/**
 * The judge's rework text as part of a sentence: trimmed, without its own end punctuation, which the message
 * templates add ("…the proposal.. Revise" was a defect).
 */
export function reworkText(rework: string): string {
  return rework.trim().replace(/[.!?。]+$/u, '');
}

/** The latest verdict whose digest matches the current artifacts; undefined when none. */
export function currentJudgeVerdict(
  state: ChangeState,
  gate: ApprovalGateId,
  digest: string | undefined,
): JudgeVerdictRecord | undefined {
  if (!digest) return undefined;
  const matches = judgeVerdicts(state, gate).filter((row) => row.digest === digest);
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

/** True when the author-critic loop has used every allowed failing verdict. */
export function judgeExhausted(config: SdlcConfig, state: ChangeState, gate: ApprovalGateId): boolean {
  const judge = gateJudge(config, gate);
  if (!judge) return false;
  return failingJudgeCount(state, gate) >= judge.maxLoops;
}

/** True when a passing verdict covers the current digest, or the loop is exhausted. */
export function judgeCleared(
  config: SdlcConfig,
  state: ChangeState,
  gate: ApprovalGateId,
  digest: string | undefined,
): boolean {
  const judge = gateJudge(config, gate);
  if (!judge) return true;
  if (judgeExhausted(config, state, gate)) return true;
  return currentJudgeVerdict(state, gate, digest)?.pass === true;
}

/**
 * Why the gate cannot be approved while the judge still holds it; undefined when no judge or the judge is cleared.
 */
export function judgeBlockReason(
  config: SdlcConfig,
  state: ChangeState,
  gate: ApprovalGateId,
  digest: string | undefined,
): LocalizedReason | undefined {
  if (!gateJudge(config, gate) || !digest) return undefined;
  if (judgeCleared(config, state, gate, digest)) return undefined;
  const current = currentJudgeVerdict(state, gate, digest);
  if (current && current.pass === false) {
    return lr('gate.judgeRework', { gate, rework: reworkText(current.rework) });
  }
  return lr('gate.judgeRequired', { gate });
}

/** Refuses approval while a configured judge has not cleared the current artifacts. */
export function assertJudgeCleared(
  config: SdlcConfig,
  state: ChangeState,
  gate: string,
  digest: string | undefined,
): void {
  if (!(gate in config.gates)) return;
  const id = gate as ApprovalGateId;
  if (!gateJudge(config, id)) return;
  if (judgeCleared(config, state, id, digest)) return;
  throw new SdlcError(
    'judge_required',
    { key: 'error.judge_required', params: { gate } },
    { key: 'fix.judge_required', params: { gate } },
  );
}

function withKey(
  action: Omit<NextAction, 'message' | 'key' | 'params'>,
  key: string,
  params: MessageParams = {},
): NextAction {
  return { ...action, key, params, message: t(key, params, 'en') };
}

/**
 * While a judge holds the gate, `next` asks the agent to run it or rework; after max_loops or a pass, the person.
 */
export function judgeNext(
  view: LifecycleView,
  config: SdlcConfig,
  state: ChangeState,
  next: NextAction,
): NextAction {
  if (next.action !== 'approve-gate' || !next.gate) return next;
  const gate = next.gate as ApprovalGateId;
  if (!gateJudge(config, gate)) return next;
  const evaluation = view.gates.find((item) => item.id === gate);
  const digest = evaluation?.digest;
  if (judgeCleared(config, state, gate, digest)) {
    if (!judgeExhausted(config, state, gate)) return next;
    const last = judgeVerdicts(state, gate).filter((row) => !row.pass).at(-1);
    if (!last) return next;
    return withKey(
      { actor: 'human', action: 'approve-gate', gate, workflow: next.workflow, cli: next.cli },
      'next.judgeEscalated',
      { gate, rework: reworkText(last.rework), change: view.change },
    );
  }
  const current = currentJudgeVerdict(state, gate, digest);
  if (current && current.pass === false) {
    return withKey(
      {
        actor: 'agent',
        action: 'revise-artifact',
        gate,
        workflow: next.workflow,
        cli: `sdlc judge --gate ${gate} --change ${view.change}`,
      },
      'next.judgeRework',
      { gate, rework: reworkText(current.rework), change: view.change },
    );
  }
  return withKey(
    {
      actor: 'agent',
      action: 'validate',
      gate,
      workflow: next.workflow,
      cli: `sdlc judge --gate ${gate} --change ${view.change}`,
    },
    'next.judgeRun',
    { gate, change: view.change },
  );
}

/** Append a verdict on the gate; creates the gate record when needed. */
export function recordJudgeVerdict(
  state: ChangeState,
  gate: ApprovalGateId,
  verdict: JudgeVerdict,
  digest: string,
): JudgeVerdictRecord {
  const row: JudgeVerdictRecord = {
    pass: verdict.pass,
    route: verdict.route,
    rework: verdict.rework,
    digest,
    at: new Date().toISOString(),
  };
  const current: GateState = state.gates[gate] ?? {};
  const judge = [...judgeVerdicts(state, gate), row];
  state.gates[gate] = { ...current, judge };
  return row;
}

/** Parse a judge answer into a verdict; throws `judge_invalid_answer` otherwise. */
export function parseJudgeVerdict(value: unknown): JudgeVerdict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidAnswer();
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.pass !== 'boolean') throw invalidAnswer();
  if (typeof raw.route !== 'string') throw invalidAnswer();
  if (typeof raw.rework !== 'string') throw invalidAnswer();
  return { pass: raw.pass, route: raw.route, rework: raw.rework };
}

function invalidAnswer(): SdlcError {
  return new SdlcError(
    'judge_invalid_answer',
    { key: 'error.judge_invalid_answer' },
    { key: 'fix.judge_invalid_answer' },
  );
}

/** Rubric file text; the path must stay inside the project root. */
export function readJudgeRubric(root: string, rubric: string): string {
  const resolved = path.resolve(root, rubric);
  if (!isWithin(root, resolved)) {
    throw new SdlcError(
      'judge_rubric_outside',
      { key: 'error.judge_rubric_outside', params: { rubric } },
    );
  }
  const text = readText(resolved);
  if (text === undefined || !isFile(resolved)) {
    throw new SdlcError(
      'judge_rubric_missing',
      { key: 'error.judge_rubric_missing', params: { rubric } },
    );
  }
  return text;
}

/** Artifact payloads for the judge request (paths relative to the change folder). */
export function judgeArtifacts(
  changeDir: string,
  files: string[],
): Array<{ path: string; content: string }> {
  return files.map((rel) => {
    const normalized = rel.replace(/\\/g, '/');
    return { path: normalized, content: readText(path.join(changeDir, rel)) ?? '' };
  });
}

/** Run the configured command judge: `run` on stdin JSON, stdout JSON (like verify: a shell string), as an agent. */
export function runJudgeCommand(
  root: string,
  run: string,
  request: JudgeRequest,
  timeoutMs = JUDGE_TIMEOUT_MS,
): Promise<JudgeVerdict> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const child = spawn(run, {
      cwd: root,
      shell: true,
      // The judge runs as an agent: a judge command can never approve or unlock in the name of who ran it.
      env: { ...process.env, SDLC_AGENT: 'judge' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.stdout?.on('data', (buf: Buffer) => chunks.push(buf));
    child.stderr?.on('data', (buf: Buffer) => errChunks.push(buf));
    child.stdin?.write(JSON.stringify(request));
    child.stdin?.end();
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new SdlcError('judge_failed', { key: 'error.judge_failed', params: { detail: error.message } }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new SdlcError('judge_timeout', { key: 'error.judge_timeout', params: { seconds: timeoutMs / 1000 } }));
        return;
      }
      if (code !== 0) {
        const err = Buffer.concat(errChunks).toString('utf-8').trim().slice(0, 200);
        reject(new SdlcError(
          'judge_failed',
          { key: 'error.judge_failed', params: { detail: err || `exit ${code ?? '?'}` } },
        ));
        return;
      }
      try {
        resolve(parseJudgeVerdict(JSON.parse(Buffer.concat(chunks).toString('utf-8'))));
      } catch (error) {
        if (error instanceof SdlcError) reject(error);
        else reject(invalidAnswer());
      }
    });
  });
}

/** Run the configured MCP tool judge; arguments are the request object. */
export async function runJudgeMcp(
  config: SdlcConfig,
  judge: Extract<JudgeConfig, { kind: 'mcp' }>,
  request: JudgeRequest,
  timeoutMs = JUDGE_TIMEOUT_MS,
): Promise<JudgeVerdict> {
  const server = (config.mcp?.servers ?? []).find((item) => item.name === judge.server);
  if (!server) {
    throw new SdlcError(
      'judge_server_missing',
      { key: 'error.judge_server_missing', params: { server: judge.server } },
    );
  }
  try {
    const answer = await callServerTool(server, judge.tool, request as unknown as Record<string, unknown>, timeoutMs);
    if (answer.isError) {
      throw new SdlcError(
        'judge_failed',
        { key: 'error.judge_failed', params: { detail: String(answer.result ?? 'tool error') } },
      );
    }
    return parseJudgeVerdict(answer.result);
  } catch (error) {
    if (error instanceof SdlcError) throw error;
    throw new SdlcError(
      'judge_failed',
      { key: 'error.judge_failed', params: { detail: error instanceof Error ? error.message : String(error) } },
    );
  }
}

/** Dispatch to the command or MCP runner for the gate's judge. */
export async function runConfiguredJudge(
  root: string,
  config: SdlcConfig,
  judge: JudgeConfig,
  request: JudgeRequest,
): Promise<JudgeVerdict> {
  if (judge.kind === 'command') return runJudgeCommand(root, judge.run, request);
  return runJudgeMcp(config, judge, request);
}