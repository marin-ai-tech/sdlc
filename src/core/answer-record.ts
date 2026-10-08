import { isSeq } from './decision-order.js';

/**
 * The record of a person's answer to an open question (0.11.4, B62): `answers` in a change's `.sdlc.yaml`. A
 * question counts as answered only when an entry names the same artifact and exactly the same question text, so
 * an "Answer" line written into the artifact without a record does not count, and a reworded question needs a new
 * answer.
 */
export const QUESTION_ARTIFACTS = ['intent', 'proposal', 'design'] as const;
export type QuestionArtifact = (typeof QUESTION_ARTIFACTS)[number];

export interface AnswerRecord {
  artifact: QuestionArtifact;
  question: string;
  answer: string;
  by: string;
  at: string;
  /** Order of the decision in the record (B39). */
  seq?: number;
}

export function isQuestionArtifact(value: unknown): value is QuestionArtifact {
  return typeof value === 'string' && (QUESTION_ARTIFACTS as readonly string[]).includes(value);
}

function answerOf(value: unknown): AnswerRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!isQuestionArtifact(raw.artifact)) return undefined;
  const texts = [raw.question, raw.answer, raw.by, raw.at];
  if (!texts.every((text) => typeof text === 'string' && text.trim() !== '')) return undefined;
  const record: AnswerRecord = {
    artifact: raw.artifact,
    question: raw.question as string,
    answer: raw.answer as string,
    by: raw.by as string,
    at: raw.at as string,
  };
  if (isSeq(raw.seq)) record.seq = raw.seq;
  return record;
}

/** The well-formed entries of `answers`; anything else (a hand edit) is ignored. */
export function parseAnswers(value: unknown): AnswerRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(answerOf).filter((record): record is AnswerRecord => record !== undefined);
}

/** True when `answers` holds an entry for exactly this artifact and question text. */
export function hasAnswer(answers: AnswerRecord[] | undefined, artifact: QuestionArtifact, question: string): boolean {
  return (answers ?? []).some((entry) => entry.artifact === artifact && entry.question === question);
}

/** The answers with `record` in place of an earlier entry for the same artifact and question. */
export function withRecordedAnswer(answers: AnswerRecord[] | undefined, record: AnswerRecord): AnswerRecord[] {
  const kept = (answers ?? []).filter((entry) => entry.artifact !== record.artifact
    || entry.question !== record.question);
  return [...kept, record];
}
