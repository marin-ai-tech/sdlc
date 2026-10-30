import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loadConfig, serializeConfig, type SdlcConfig } from '../core/config.js';
import { readBoard, type Board } from '../core/board-store.js';
import { listFilesRecursive } from '../core/fs-utils.js';
import { git } from '../core/git.js';
import { LIMITS, canonical, fail, json, parseExtensions, type Actor, type Extensions, type Hook, type Json } from './api.js';
import { withActivation } from './activation.js';
import { activePlugins } from './catalog.js';
import { evaluateHooks, type HookDecision } from './hooks.js';
import { hash } from './package.js';
import { validateExtensions } from './runtime.js';
import { withStore } from './store.js';
import { currentActive, type ActivePlugin } from './trust.js';

export interface OperationBinding { operation: string; args: unknown; actor: Actor; board: boolean }
export interface EvaluationContext { readonly context: unique symbol }
export function extensionInput(text: string | undefined): Extensions | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('plugin_invalid', 'Extensions must be valid JSON'); }
  return parseExtensions(value);
}
interface HookRequest { hook: Hook; subject: Json }
interface ExtensionRequest { kind: 'taskExt' | 'bidExt'; value: Extensions }
interface Candidate { branch: string; base?: string; head: string; baseSha: string }
interface Scope {
  root: string; binding: OperationBinding; args: string; callerConfig: SdlcConfig; configSemantic: string; plugins: ActivePlugin[];
  fingerprint: string; board: Board; boardDigest: string; now: number; deadline: number;
  mode: 'probe' | 'final'; used: boolean; attempted: boolean; entered: boolean; finalizing: boolean; replay: boolean;
  calls: Set<string>; neededHooks: Map<string, HookRequest>; verdicts: Map<string, HookDecision>;
  neededExtensions: Map<string, ExtensionRequest>; extensions: Set<string>; candidates: Map<string, Candidate>;
  baseline: Board; observations: Array<() => void>; flushing: boolean; faulted: boolean;
}
const contexts = new WeakMap<object, Scope>();
const scopeStorage = new AsyncLocalStorage<Scope>();
const BOARD_OPERATIONS = new Set(['list', 'claim', 'heartbeat', 'release', 'submit', 'auction', 'bid', 'award', 'dispatch']);
const NESTED: Record<string, readonly string[]> = { claim: ['export'], dispatch: ['export'], submit: ['result'] };

function coreJson(value: unknown): Json {
  try { return json(JSON.parse(JSON.stringify(value ?? null))); }
  catch { return fail('plugin_evaluation_context', 'Operation arguments must be bounded JSON'); }
}
function callKey(operation: string, args: unknown): string { return hash(canonical({ operation, args: coreJson(args) })); }
function current(root: string): Scope | undefined {
  const scope = scopeStorage.getStore();
  if (scope && scope.root !== fs.realpathSync(root)) fail('plugin_evaluation_context', 'Evaluation belongs to another project');
  return scope;
}
function projectConfig(root: string, fallback: SdlcConfig): SdlcConfig {
  const file = path.join(root, 'openspec/sdlc.yaml');
  return fs.existsSync(file) ? loadConfig(file) : fallback;
}
export function restrictionsConfigured(root: string, config: SdlcConfig): boolean {
  const actual = projectConfig(root, config);
  return Object.values(actual.plugins ?? {}).some((setting) => setting.enabled) || !!actual.pluginPolicies?.length;
}

/** Primary operations bind their real core arguments. Nested pure export/result calls are recorded in probes. */
export function declareOperation(root: string, config: SdlcConfig, operation: string, args: unknown): void {
  const scope = current(root);
  if (!scope) {
    const ext = args && typeof args === 'object' && 'ext' in args ? args.ext : undefined;
    if (restrictionsConfigured(root, config) || ext !== undefined) fail('plugin_evaluation_required', 'Prepare this operation outside mutation locks');
    return;
  }
  const key = callKey(operation, args);
  if (canonical(serializeConfig(config), LIMITS.packageBytes) !== scope.configSemantic) {
    fail('plugin_evaluation_stale', 'Core caller configuration changed');
  }
  if (scope.mode === 'final' && scope.used && !scope.finalizing) fail('plugin_evaluation_context', 'Finalization has ended');
  if (!scope.entered) {
    if (scope.binding.operation !== operation || scope.args !== canonical(coreJson(args))) {
      fail('plugin_evaluation_context', 'Evaluation operation or arguments differ');
    }
    scope.entered = true;
  } else if (!(NESTED[scope.binding.operation] ?? []).includes(operation)) {
    fail('plugin_evaluation_context', 'Evaluation cannot be reused for another operation');
  }
  if (scope.mode === 'probe') scope.calls.add(key);
  else if (!scope.calls.has(key)) fail('plugin_evaluation_stale', 'Nested core input changed');
}

export function isPreparation(root: string): boolean { return current(root)?.mode === 'probe'; }
export function publicationAllowed(root: string): boolean { return !current(root)?.faulted; }
export function deferObservation(root: string, write: () => void): boolean {
  const scope = current(root);
  if (!scope || scope.mode !== 'final' || !scope.finalizing || scope.flushing) return false;
  scope.observations.push(write);
  return true;
}
export function flushObservations(root: string): void {
  const scope = current(root);
  if (!scope) return;
  if (scope.faulted) { scope.observations.length = 0; return; }
  scope.flushing = true;
  try {
    for (const write of scope.observations.splice(0)) {
      try { write(); } catch { /* Core observations remain best effort. */ }
    }
  } finally { scope.flushing = false; }
}
export function evaluationTime(root: string): number { return current(root)?.now ?? Date.now(); }
export function effectTime(root: string, fallback = Date.now()): number {
  const scope = current(root);
  return scope?.mode === 'probe' ? scope.now : scope?.mode === 'final' ? Date.now() : fallback;
}
export function boardLockWait(root: string, fallback: number): number {
  const scope = current(root);
  return scope ? Math.max(0, Math.min(50, scope.deadline - performance.now())) : fallback;
}
export function preparationBoard(root: string): Board | undefined {
  const scope = current(root);
  if (scope?.mode !== 'probe') return undefined;
  return scope.board;
}
export function historicalReplay(root: string): void { const scope = current(root); if (scope) scope.replay = true; }

export function consumeExtensions(root: string, kind: ExtensionRequest['kind'], raw: unknown): Extensions | undefined {
  const value = parseExtensions(raw);
  if (value === undefined) return undefined;
  const scope = current(root);
  if (!scope) fail('plugin_evaluation_required', 'Extensions require accepted-schema preparation');
  if (scope.mode === 'final' && !scope.finalizing) fail('plugin_evaluation_context', 'Extensions must be consumed inside finalization');
  const key = callKey(kind, value);
  if (scope.mode === 'probe') scope.neededExtensions.set(key, { kind, value });
  else if (!scope.extensions.has(key)) fail('plugin_evaluation_stale', 'Extension validation is absent or stale');
  return value;
}

export function consumeHook(root: string, config: SdlcConfig, hook: Hook, subject: unknown): HookDecision {
  const scope = current(root);
  if (!scope) {
    if (restrictionsConfigured(root, config)) fail('plugin_evaluation_required', 'Hook evaluation is required');
    return { decision: 'pass' };
  }
  const value = coreJson(subject);
  if (scope.mode === 'final' && !scope.finalizing) fail('plugin_evaluation_context', 'Verdicts must be consumed inside finalization');
  const key = callKey(hook, value);
  if (scope.mode === 'probe') {
    scope.neededHooks.set(key, { hook, subject: value });
    return scope.verdicts.get(key) ?? { decision: 'pass' };
  }
  const verdict = scope.verdicts.get(key);
  if (!verdict) fail('plugin_evaluation_stale', 'Hook inputs differ from the prepared operation');
  return verdict;
}
export function assertHook(root: string, config: SdlcConfig, hook: Hook, subject: unknown): void {
  const verdict = consumeHook(root, config, hook, subject);
  if (verdict.decision === 'deny') {
    const source = verdict.plugin ? `${verdict.plugin.name}@${verdict.plugin.version} ${verdict.plugin.digest}`
      : verdict.policy ? `Policy ${verdict.policy}` : 'Plugin restriction';
    fail('plugin_refused', `${source}: ${verdict.message ?? verdict.code ?? 'Operation refused'}`);
  }
}

/** Resolving aliases once keeps the actual check on the same immutable candidate after final comparison. */
export function immutableCandidate(root: string, branch: string, base: string | undefined,
  resolve: () => { head: string; baseSha: string }): { head: string; baseSha: string } {
  const scope = current(root);
  if (!scope) return resolve();
  const key = callKey('candidate', { branch, base });
  const captured = scope.candidates.get(key);
  if (captured) return captured;
  if (scope.mode === 'final') fail('plugin_evaluation_stale', 'Candidate was not captured');
  const candidate = { branch, ...(base ? { base } : {}), ...resolve() };
  scope.candidates.set(key, candidate);
  return candidate;
}

function content(root: string, relative: string): string | null {
  const file = path.join(root, relative);
  try { return hash(fs.readFileSync(file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function fingerprint(root: string): string {
  const files = new Set(['openspec/sdlc.yaml', 'openspec/roles.yaml', 'openspec/executors.yaml',
    'openspec/.sdlc/board.json', 'openspec/.sdlc/team.json', 'CLAUDE.md', 'AGENTS.md', 'REVIEW.md']);
  const changes = path.join(root, 'openspec/changes');
  const active = fs.existsSync(changes) ? fs.readdirSync(changes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive').map((entry) => `openspec/changes/${entry.name}`) : [];
  for (const parent of [...active, 'openspec/specs']) {
    for (const file of listFilesRecursive(path.join(root, parent))) {
      if (!/\.md$|(?:^|\/)\.sdlc\.yaml$/.test(file)) continue;
      files.add(`${parent}/${file}`);
      if (files.size > 4096) fail('plugin_limit', 'Too many lifecycle inputs for one evaluation');
    }
  }
  const records = [...files].sort().map((file) => [file, content(root, file)]);
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  return hash(JSON.stringify([records, head.ok ? head.stdout : null]));
}
function temporal(board: Board, now: number): string {
  return JSON.stringify([
    board.auctions.filter((a) => Date.parse(a.closesAt) <= now).map((a) => a.item),
    board.claims.filter((c) => c.state === 'held' && Date.parse(c.expiresAt) <= now).map((c) => c.id),
    board.dispatches.filter((d) => Date.parse(d.expiresAt) <= now).map((d) => d.item),
    board.requests.filter((r) => Date.parse(r.at) <= now - LIMITS.receiptMs).map((r) => r.key),
  ]);
}
function stateLocks<T>(scope: Scope, action: () => T, index = 0): T {
  const plugins = [...scope.plugins].sort((a, b) => a.snapshot.manifest.name.localeCompare(b.snapshot.manifest.name));
  return index === plugins.length ? action() : withStore(scope.root, plugins[index].snapshot.manifest.name,
    () => stateLocks(scope, action, index + 1));
}
function validateCurrent(scope: Scope, board?: Board, recheck = false): void {
  if (scope.used && !recheck || !scope.entered) fail('plugin_evaluation_context', 'Evaluation is missing or already consumed');
  if (performance.now() >= scope.deadline) fail('plugin_timeout', 'Operation preparation deadline exceeded');
  if (fingerprint(scope.root) !== scope.fingerprint) fail('plugin_evaluation_stale', 'Core operation inputs changed');
  if (canonical(serializeConfig(scope.callerConfig), LIMITS.packageBytes) !== scope.configSemantic) {
    fail('plugin_evaluation_stale', 'Core caller configuration changed');
  }
  if (board && hash(JSON.stringify(board)) !== scope.boardDigest) fail('plugin_evaluation_stale', 'Board snapshot changed');
  for (const plugin of scope.plugins) currentActive(scope.root, plugin);
  for (const candidate of scope.candidates.values()) {
    const actual = git(scope.root, ['rev-parse', '--verify', '--end-of-options', `${candidate.branch}^{commit}`]);
    const base = candidate.base ? git(scope.root, ['rev-parse', '--verify', '--end-of-options', `${candidate.base}^{commit}`]) : undefined;
    if (!actual.ok || actual.stdout !== candidate.head || base && (!base.ok || base.stdout !== candidate.baseSha)) {
      fail('plugin_evaluation_stale', 'Candidate or base reference changed');
    }
  }
  if (performance.now() >= scope.deadline) fail('plugin_timeout', 'Operation preparation deadline exceeded');
  if (scope.binding.board && temporal(scope.baseline, scope.now) !== temporal(scope.baseline, Date.now())) {
    fail('plugin_evaluation_stale', 'Board clock eligibility changed');
  }
}
export function beforeBoardCommit(root: string): void {
  const scope = current(root);
  if (scope) validateCurrent(scope, undefined, true);
}
function finalize<T>(scope: Scope, action: () => T, board?: Board): T {
  return withActivation(scope.root, () => stateLocks(scope, () => {
    validateCurrent(scope, board);
    scope.used = true;
    scope.finalizing = true;
    try {
      const result = action();
      if (!scope.binding.board) {
        validateCurrent(scope, undefined, true);
        flushObservations(scope.root);
      }
      return result;
    } finally { scope.finalizing = false; }
  }));
}
/** Called under the existing board lock, before its write-on-error scope begins. */
export function finalizeBoard<T>(root: string, board: Board, action: () => T): T {
  const scope = current(root);
  if (!scope) return action();
  if (!scope.binding.board || scope.mode !== 'final') fail('plugin_evaluation_context', 'Board operation requires its own context');
  return finalize(scope, action, board);
}

function resetProbe(scope: Scope, initial: Board): void {
  scope.mode = 'probe'; scope.entered = false; scope.replay = false;
  scope.board = structuredClone(initial); scope.neededHooks.clear(); scope.neededExtensions.clear();
}
export async function prepareEvaluation(root: string, config: SdlcConfig, binding: OperationBinding, work: () => unknown,
  deadline = performance.now() + LIMITS.operationMs): Promise<EvaluationContext | undefined> {
  root = fs.realpathSync(root);
  const supplied = config;
  config = projectConfig(root, config);
  const raw = coreJson(binding.args);
  const extended = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.ext !== undefined;
  const enabled = (value: SdlcConfig) => Object.values(value.plugins ?? {}).some((setting) => setting.enabled) || !!value.pluginPolicies?.length;
  if (!enabled(supplied) && !enabled(config) && !extended) return undefined;
  if (canonical(serializeConfig(supplied), LIMITS.packageBytes) !== canonical(serializeConfig(config), LIMITS.packageBytes)) {
    fail('plugin_evaluation_stale', 'Caller configuration differs from the current core settings');
  }
  if (binding.board !== BOARD_OPERATIONS.has(binding.operation)) fail('plugin_evaluation_context', 'Wrong mutation boundary');
  const initial = readBoard(root);
  const scope: Scope = { root, callerConfig: supplied, configSemantic: canonical(serializeConfig(config), LIMITS.packageBytes),
    binding: { ...binding, args: raw, actor: coreJson(binding.actor) as unknown as Actor },
    args: canonical(raw), plugins: [], fingerprint: fingerprint(root), board: structuredClone(initial),
    boardDigest: hash(JSON.stringify(initial)), now: Date.now(), deadline, mode: 'probe', used: false,
    entered: false, attempted: false, finalizing: false, replay: false, calls: new Set(), neededHooks: new Map(),
    verdicts: new Map(), neededExtensions: new Map(), extensions: new Set(), candidates: new Map(),
    baseline: structuredClone(initial), observations: [], flushing: false, faulted: false };
  for (let pass = 0; pass < 3; pass++) {
    resetProbe(scope, initial);
    let coreError: unknown;
    try {
      const result = scopeStorage.run(scope, work);
      if (result && typeof result === 'object' && 'then' in result) {
        Promise.resolve(result).catch(() => {});
        fail('plugin_evaluation_context', 'Prepared core callbacks must be synchronous');
      }
    } catch (error) { coreError = error; }
    if (!scope.entered) throw coreError ?? new Error('Core operation did not declare its boundary');
    if (coreError && typeof coreError === 'object' && 'code' in coreError && coreError.code === 'plugin_evaluation_context') throw coreError;
    if (scope.replay) break; // Historical preflight precedes all guest/schema work.
    if (!scope.plugins.length && (scope.neededHooks.size || scope.neededExtensions.size)) {
      try { scope.plugins = activePlugins(root, config); } catch (error) { throw coreError ?? error; }
    }
    let pending = 0;
    for (const [key, request] of scope.neededExtensions) {
      if (scope.extensions.has(key)) continue;
      await validateExtensions(scope.plugins.map((p) => p.snapshot), request.kind, request.value, deadline - performance.now());
      scope.extensions.add(key); pending++;
    }
    for (const [key, request] of scope.neededHooks) {
      if (scope.verdicts.has(key)) continue;
      try {
        const checked = await evaluateHooks(root, config, request.hook, request.subject, scope.binding.actor, scope.plugins, deadline);
        if (checked.verdict.fault) scope.faulted = true;
        scope.verdicts.set(key, checked.verdict); pending++;
      } catch (error) { throw coreError ?? error; }
    }
    if (!pending) break;
    if (pass === 2) fail('plugin_evaluation_stale', 'Operation inputs did not converge during preparation');
  }
  scope.mode = 'final'; scope.entered = false;
  const token = Object.freeze({ toJSON() { fail('plugin_evaluation_context', 'Evaluation contexts cannot be serialized'); } });
  contexts.set(token, scope);
  return token as unknown as EvaluationContext;
}

export function executePrepared<T>(token: EvaluationContext | undefined, work: () => T): T {
  if (!token) return work();
  const scope = contexts.get(token);
  if (!scope || scope.used || scope.attempted) fail('plugin_evaluation_context', 'Forged or reused evaluation context');
  scope.attempted = true;
  if (scope.binding.board) return scopeStorage.run(scope, work);
  return scopeStorage.run(scope, () => {
    // Non-board core checks run under the same activation/state finalization protocol.
    scope.entered = true;
    return finalize(scope, () => { scope.entered = false; return work(); });
  });
}
export async function runPrepared<T>(root: string, config: SdlcConfig, binding: OperationBinding, work: () => T): Promise<T> {
  const deadline = performance.now() + LIMITS.operationMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return executePrepared(await prepareEvaluation(root, config, binding, work, deadline), work); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (!['plugin_evaluation_stale', 'plugin_busy', 'board_locked'].includes(String(code)) || attempt === 2
        || performance.now() >= deadline) throw error;
    }
  }
  return fail('plugin_evaluation_stale', 'Preparation retry limit exceeded');
}
