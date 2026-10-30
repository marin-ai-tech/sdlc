import { loadProject, recordChangeEvent } from '../cli/context.js';
import { resolveNext } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { isQuestionArtifact, QUESTION_ARTIFACTS, withRecordedAnswer, } from '../core/answer-record.js';
import { artifactFile, artifactQuestions, listQuestions } from '../core/answers.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { nextSeq } from '../core/decision-order.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { answerLine, withAnswer } from '../core/open-questions.js';
import { readRolesFile } from '../core/roles.js';
import { approvalIdentity, assertHuman } from './gates.js';
export const QUESTION_ANSWERED_EVENT = 'question.answered';
export async function answerCommand(n, opts) {
    try {
        if (opts.list)
            return listCommand(opts);
        const ctx = loadProject();
        assertHuman(ctx.config, 'answer');
        const artifact = parseArtifact(opts.artifact) ?? 'intent';
        const text = answerText(opts.text);
        const ref = resolveChange(ctx.paths, opts.change);
        const question = pickQuestion(ref, artifact, n);
        const record = recordAnswer(ctx, ref, artifact, question, text);
        printAnswer(ctx, ref, question, record, opts.json);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function invalidOption(key, params = {}) {
    return new SdlcError('invalid_option', { key, params });
}
function parseArtifact(value) {
    if (value === undefined)
        return undefined;
    if (isQuestionArtifact(value))
        return value;
    throw invalidOption('error.answer_artifact', { artifact: value, allowed: QUESTION_ARTIFACTS.join(', ') });
}
/** The answer as written: one line, trimmed; empty or blank text is refused. */
function answerText(value) {
    const text = (value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (text === '')
        throw invalidOption('error.answer_text_required');
    // An answer must not hide the questions after it inside an HTML comment.
    return text.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
}
function pickQuestion(ref, artifact, n) {
    if (n === undefined)
        throw invalidOption('error.answer_number_required');
    const questions = artifactQuestions(ref.dir, artifact);
    const index = /^\d+$/.test(n.trim()) ? Number(n.trim()) : NaN;
    const question = questions.find((item) => item.n === index);
    if (question && questions.filter((item) => item.text === question.text).length > 1) {
        // Answers are keyed by the question's text: two questions with one text would share one answer.
        throw invalidOption('error.answer_duplicate_question', { n, artifact });
    }
    if (question)
        return question;
    const params = { n, artifact, count: questions.length };
    throw invalidOption(questions.length > 0 ? 'error.answer_out_of_range' : 'error.answer_no_questions', params);
}
/** Today in the person's local time, `YYYY-MM-DD`. */
function localDate(now) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/** The person's name from `Name <email>`; the identity as it is otherwise. */
function personName(identity) {
    const name = identity.replace(/\s*<[^>]*>\s*$/, '').trim();
    return name === '' ? identity : name;
}
/** Writes the answer under the question, then the record entry and the `question.answered` event. */
function recordAnswer(ctx, ref, artifact, question, answer) {
    const by = approvalIdentity(ctx.root, readRolesFile(ctx.root), undefined);
    const now = new Date();
    const file = artifactFile(ref.dir, artifact);
    const content = readText(file) ?? '';
    writeTextAtomic(file, withAnswer(content, question, answerLine(personName(by), localDate(now), answer)));
    const state = readChangeState(ref.dir);
    const record = { artifact, question: question.text, answer, by, at: now.toISOString(),
        seq: nextSeq(state) };
    state.answers = withRecordedAnswer(state.answers, record);
    recordChangeEvent(ctx, ref, state, QUESTION_ANSWERED_EVENT, by, `${artifact} ${question.n}: ${question.text}`);
    return record;
}
function printAnswer(ctx, ref, question, record, json) {
    const next = resolveNext(ctx, ref.id);
    if (json) {
        printJson({ change: ref.id, n: question.n, ...record, ...(next ? { next } : {}) });
        return;
    }
    const params = { n: question.n, artifact: record.artifact, by: record.by };
    line(c.green(t('answer.recorded', params)));
}
function listCommand(opts) {
    const ctx = loadProject();
    const artifact = parseArtifact(opts.artifact);
    const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
    const questions = listQuestions(ref.dir, readChangeState(ref.dir), artifact ? [artifact] : QUESTION_ARTIFACTS);
    if (opts.json) {
        printJson({ change: ref.id, questions });
        return;
    }
    printList(questions);
}
function printList(questions) {
    if (questions.length === 0) {
        line(t('answer.none'));
        return;
    }
    for (const question of questions) {
        const mark = question.answered ? c.green('[x]') : c.yellow('[ ]');
        line(`${mark} ${question.artifact} ${question.n}. ${question.text}`);
        if (question.answer !== undefined)
            line(c.dim(`    ${t('answer.answerLabel')}: ${question.answer}`));
    }
}
