import { isSeq } from './decision-order.js';
/**
 * The record of a person's answer to an open question (0.11.4, B62): `answers` in a change's `.sdlc.yaml`. A
 * question counts as answered only when an entry names the same artifact and exactly the same question text, so
 * an "Answer" line written into the artifact without a record does not count, and a reworded question needs a new
 * answer.
 */
export const QUESTION_ARTIFACTS = ['intent', 'proposal', 'design'];
export function isQuestionArtifact(value) {
    return typeof value === 'string' && QUESTION_ARTIFACTS.includes(value);
}
function answerOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    if (!isQuestionArtifact(raw.artifact))
        return undefined;
    const texts = [raw.question, raw.answer, raw.by, raw.at];
    if (!texts.every((text) => typeof text === 'string' && text.trim() !== ''))
        return undefined;
    const record = {
        artifact: raw.artifact,
        question: raw.question,
        answer: raw.answer,
        by: raw.by,
        at: raw.at,
    };
    if (isSeq(raw.seq))
        record.seq = raw.seq;
    return record;
}
/** The well-formed entries of `answers`; anything else (a hand edit) is ignored. */
export function parseAnswers(value) {
    if (!Array.isArray(value))
        return [];
    return value.map(answerOf).filter((record) => record !== undefined);
}
/** True when `answers` holds an entry for exactly this artifact and question text. */
export function hasAnswer(answers, artifact, question) {
    return (answers ?? []).some((entry) => entry.artifact === artifact && entry.question === question);
}
/** The answers with `record` in place of an earlier entry for the same artifact and question. */
export function withRecordedAnswer(answers, record) {
    const kept = (answers ?? []).filter((entry) => entry.artifact !== record.artifact
        || entry.question !== record.question);
    return [...kept, record];
}
