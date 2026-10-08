import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';

/**
 * `questions: { required: <bool> }` in openspec/sdlc.yaml (0.11.4, B62). `required` (default true): the intent and
 * spec gates are approved only once every open question of their artifacts has a recorded answer. Parsed into a
 * typed field here; config.ts only calls `parseQuestionsConfig`. Any other key under `questions`, or a value that
 * is not a boolean, is `invalid_config`. Never written back, so the file keeps it as people wrote it.
 */
export interface QuestionsConfig {
  required: boolean;
}

const KEYS = ['required'];

function invalid(key: string, where: string): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where } });
}

/** `questions`: absent = undefined (the default applies). */
export function parseQuestionsConfig(value: unknown, where: (key: string) => string): QuestionsConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where('questions'));
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).find((key) => !KEYS.includes(key));
  if (unknown !== undefined) throw invalid('error.questions_unknown_key', where(`questions.${unknown}`));
  if (raw.required === undefined || raw.required === null) return { required: true };
  if (typeof raw.required !== 'boolean') throw invalid('error.x_must_be_true_or_false', where('questions.required'));
  return { required: raw.required };
}

/** True unless sdlc.yaml says `questions.required: false`. */
export function questionsRequired(config: Pick<SdlcConfig, 'questions'>): boolean {
  return config.questions?.required !== false;
}
