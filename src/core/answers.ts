import * as path from 'node:path';
import { hasAnswer, QUESTION_ARTIFACTS, type QuestionArtifact } from './answer-record.js';
import type { ChangeState } from './change-state.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
import { parseOpenQuestions, type OpenQuestion } from './open-questions.js';
import { questionsRequired } from './questions-config.js';

/**
 * Answers to open questions (0.11.4, B62): which questions of a change's intent, proposal and design have a
 * person's recorded answer, and the approval check. `sdlc approve intent` (intent.md) and `sdlc approve spec`
 * (proposal.md, design.md) refuse with `open_questions` while one has none, unless `questions.required: false`.
 * The check runs when approving, never when the gate status is evaluated, so approvals given before stay valid.
 */
export interface ListedQuestion {
  artifact: QuestionArtifact;
  n: number;
  text: string;
  answered: boolean;
  answer?: string;
}

export interface UnansweredQuestion {
  artifact: QuestionArtifact;
  n: number;
  text: string;
}

/** The artifacts whose questions an approval of the gate needs answered. */
const GATE_ARTIFACTS: Partial<Record<ApprovalGateId, readonly QuestionArtifact[]>> = {
  intent: ['intent'],
  spec: ['proposal', 'design'],
};

export function gateQuestionArtifacts(gate: string): readonly QuestionArtifact[] {
  return GATE_ARTIFACTS[gate as ApprovalGateId] ?? [];
}

export function artifactFile(changeDir: string, artifact: QuestionArtifact): string {
  return path.join(changeDir, `${artifact}.md`);
}

/** The open questions of one artifact of the change; none when its file does not exist. */
export function artifactQuestions(changeDir: string, artifact: QuestionArtifact): OpenQuestion[] {
  const text = readText(artifactFile(changeDir, artifact));
  return text === undefined ? [] : parseOpenQuestions(text);
}

function listedQuestion(state: ChangeState, artifact: QuestionArtifact, question: OpenQuestion): ListedQuestion {
  const entry = (state.answers ?? []).find((item) => item.artifact === artifact && item.question === question.text);
  const listed: ListedQuestion = { artifact, n: question.n, text: question.text, answered: entry !== undefined };
  if (entry) listed.answer = entry.answer;
  return listed;
}

/** Every open question of the artifacts (default: intent, proposal and design) and whether it is answered. */
export function listQuestions(changeDir: string, state: ChangeState,
  artifacts: readonly QuestionArtifact[] = QUESTION_ARTIFACTS): ListedQuestion[] {
  return artifacts.flatMap((artifact) => artifactQuestions(changeDir, artifact)
    .map((question) => listedQuestion(state, artifact, question)));
}

/** The questions of the gate's artifacts without a recorded answer. */
export function unansweredQuestions(changeDir: string, state: ChangeState, gate: string): UnansweredQuestion[] {
  return gateQuestionArtifacts(gate).flatMap((artifact) => artifactQuestions(changeDir, artifact)
    .filter((question) => !hasAnswer(state.answers, artifact, question.text))
    .map((question) => ({ artifact, n: question.n, text: question.text })));
}

/** The unanswered questions that hold the gate's approval: none when `questions.required` is false. */
export function blockingQuestions(config: SdlcConfig, changeDir: string, state: ChangeState,
  gate: string): UnansweredQuestion[] {
  return questionsRequired(config) ? unansweredQuestions(changeDir, state, gate) : [];
}

/** The `sdlc answer` call for a question (the artifact named unless it is the default, intent). */
export function answerCli(change: string, question: Pick<UnansweredQuestion, 'artifact' | 'n'>): string {
  const artifact = question.artifact === 'intent' ? '' : ` --artifact ${question.artifact}`;
  return `sdlc answer ${question.n} --change ${change}${artifact} --text "…"`;
}

/** Refuses the approval of the gate while one of its questions has no recorded answer (`open_questions`). */
export function assertQuestionsAnswered(config: SdlcConfig, change: string, changeDir: string, state: ChangeState,
  gate: string): void {
  const open = blockingQuestions(config, changeDir, state, gate);
  if (open.length === 0) return;
  const artifacts = [...new Set(open.map((question) => `${question.artifact}.md`))].join(', ');
  const fix = { n: open[0].n, change, artifact: open[0].artifact, cli: answerCli(change, open[0]) };
  throw new SdlcError(
    'open_questions',
    { key: 'error.open_questions', params: { gate, count: open.length, artifacts } },
    { key: 'fix.open_questions', params: fix },
  );
}
