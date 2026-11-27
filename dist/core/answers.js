import * as path from 'node:path';
import { hasAnswer, QUESTION_ARTIFACTS } from './answer-record.js';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
import { parseOpenQuestions } from './open-questions.js';
import { questionsRequired } from './questions-config.js';
/** The artifacts whose questions an approval of the gate needs answered. */
const GATE_ARTIFACTS = {
    intent: ['intent'],
    spec: ['proposal', 'design'],
};
export function gateQuestionArtifacts(gate) {
    return GATE_ARTIFACTS[gate] ?? [];
}
export function artifactFile(changeDir, artifact) {
    return path.join(changeDir, `${artifact}.md`);
}
/** The open questions of one artifact of the change; none when its file does not exist. */
export function artifactQuestions(changeDir, artifact) {
    const text = readText(artifactFile(changeDir, artifact));
    return text === undefined ? [] : parseOpenQuestions(text);
}
function listedQuestion(state, artifact, question) {
    const entry = (state.answers ?? []).find((item) => item.artifact === artifact && item.question === question.text);
    const listed = { artifact, n: question.n, text: question.text, answered: entry !== undefined };
    if (entry)
        listed.answer = entry.answer;
    return listed;
}
/** Every open question of the artifacts (default: intent, proposal and design) and whether it is answered. */
export function listQuestions(changeDir, state, artifacts = QUESTION_ARTIFACTS) {
    return artifacts.flatMap((artifact) => artifactQuestions(changeDir, artifact)
        .map((question) => listedQuestion(state, artifact, question)));
}
/** The questions of the gate's artifacts without a recorded answer. */
export function unansweredQuestions(changeDir, state, gate) {
    return gateQuestionArtifacts(gate).flatMap((artifact) => artifactQuestions(changeDir, artifact)
        .filter((question) => !hasAnswer(state.answers, artifact, question.text))
        .map((question) => ({ artifact, n: question.n, text: question.text })));
}
/** The unanswered questions that hold the gate's approval: none when `questions.required` is false. */
export function blockingQuestions(config, changeDir, state, gate) {
    return questionsRequired(config) ? unansweredQuestions(changeDir, state, gate) : [];
}
/** The `sdlc answer` call for a question (the artifact named unless it is the default, intent). */
export function answerCli(change, question) {
    const artifact = question.artifact === 'intent' ? '' : ` --artifact ${question.artifact}`;
    return `sdlc answer ${question.n} --change ${change}${artifact} --text "…"`;
}
/** Refuses the approval of the gate while one of its questions has no recorded answer (`open_questions`). */
export function assertQuestionsAnswered(config, change, changeDir, state, gate) {
    const open = blockingQuestions(config, changeDir, state, gate);
    if (open.length === 0)
        return;
    const artifacts = [...new Set(open.map((question) => `${question.artifact}.md`))].join(', ');
    const fix = { n: open[0].n, change, artifact: open[0].artifact, cli: answerCli(change, open[0]) };
    throw new SdlcError('open_questions', { key: 'error.open_questions', params: { gate, count: open.length, artifacts } }, { key: 'fix.open_questions', params: fix });
}
