/**
 * `sdlc judge --gate <g> --change <id> [--json]` (B19): any actor (an agent too) runs the configured judge for a gate.
 * Sends `{ change, gate, rubric, artifacts }` to the command (stdin) or MCP tool (arguments), records a valid verdict
 * bound to the artifact digest, and exits 0 on pass / 1 on fail. An invalid answer is `judge_invalid_answer` and
 * records nothing. Timeouts and a failing process are errors, never a pass.
 */
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { resolveNext } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { APPROVAL_GATES, type ApprovalGateId } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';
import {
  judgeArtifacts,
  readJudgeRubric,
  recordJudgeVerdict,
  runConfiguredJudge,
  type JudgeRequest,
} from '../core/judge-gate.js';
import { evaluateChange } from '../core/lifecycle.js';

export interface JudgeOptions {
  gate?: string;
  change?: string;
  json?: boolean;
}

export async function judgeCommand(opts: JudgeOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(opts.gate);
    const judge = ctx.config.gates[gate].judge;
    if (!judge) {
      throw new SdlcError(
        'judge_not_configured',
        { key: 'error.judge_not_configured', params: { gate } },
      );
    }
    const ref = resolveChange(ctx.paths, opts.change);
    const view = evaluateChange(ctx.root, ref, ctx.config);
    const evaluation = view.gates.find((item) => item.id === gate);
    if (!evaluation?.digest) {
      throw new SdlcError(
        'gate_not_ready',
        { key: 'error.nothing_to_approve_for_the_x_gate_yet', params: { gate } },
      );
    }
    const files = view.artifacts
      .filter((artifact) => evaluation.artifacts.includes(artifact.id))
      .flatMap((artifact) => artifact.files);
    const request: JudgeRequest = {
      change: ref.id,
      gate,
      rubric: readJudgeRubric(ctx.root, judge.rubric),
      artifacts: judgeArtifacts(ref.dir, files),
    };
    const verdict = await runConfiguredJudge(ctx.root, ctx.config, judge, request);
    const state = readChangeState(ref.dir);
    const recorded = recordJudgeVerdict(state, gate, verdict, evaluation.digest);
    const by = agentEnvironment() ?? 'judge';
    recordChangeEvent(
      ctx, ref, state, `gate.${gate}.judged`, by,
      verdict.pass ? 'pass' : `fail: ${verdict.rework}`,
    );
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({
        change: ref.id,
        gate,
        verdict: { pass: recorded.pass, route: recorded.route, rework: recorded.rework },
        digest: recorded.digest,
        ...(next ? { next } : {}),
      });
    } else {
      const key = verdict.pass ? 'judge.passed' : 'judge.failed';
      line(c[verdict.pass ? 'green' : 'red'](t(key, { gate, route: verdict.route })));
      if (!verdict.pass && verdict.rework) line(t('judge.rework', { rework: verdict.rework }));
    }
    if (!verdict.pass) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

function parseGate(value: string | undefined): ApprovalGateId {
  if (!value || !(APPROVAL_GATES as readonly string[]).includes(value)) {
    throw new SdlcError(
      'invalid_option',
      { key: 'error.x_is_not_a_known_gate_x', params: { p1: value ?? '', p2: APPROVAL_GATES.join(', ') } },
    );
  }
  return value as ApprovalGateId;
}