import { SdlcError } from './errors.js';
const KEYS = ['required'];
function invalid(key, where) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where } });
}
/** `questions`: absent = undefined (the default applies). */
export function parseQuestionsConfig(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', where('questions'));
    const raw = value;
    const unknown = Object.keys(raw).find((key) => !KEYS.includes(key));
    if (unknown !== undefined)
        throw invalid('error.questions_unknown_key', where(`questions.${unknown}`));
    if (raw.required === undefined || raw.required === null)
        return { required: true };
    if (typeof raw.required !== 'boolean')
        throw invalid('error.x_must_be_true_or_false', where('questions.required'));
    return { required: raw.required };
}
/** True unless sdlc.yaml says `questions.required: false`. */
export function questionsRequired(config) {
    return config.questions?.required !== false;
}
