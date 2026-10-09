/**
 * A failure the CLI reports as a diagnostic instead of a stack trace.
 *
 * `code` is a stable snake_case identifier agents can branch on, `fix` is one
 * actionable sentence or command. The shape mirrors OpenSpec's diagnostic
 * envelope (severity/code/message/fix) so agents that already parse OpenSpec
 * JSON can read ours the same way.
 *
 * Message and fix may be plain strings or { key, params } locale refs. English
 * (via t(..., 'en')) is always stored on message/fix for JSON and
 * toDiagnostic; text output uses localizedMessage()/localizedFix().
 */
import { t } from './i18n.js';
function englishText(text) {
    if (typeof text === 'string')
        return text;
    return t(text.key, text.params, 'en');
}
function localizedText(text) {
    if (text === undefined)
        return undefined;
    if (typeof text === 'string')
        return text;
    return t(text.key, text.params);
}
export class SdlcError extends Error {
    code;
    fix;
    messageLoc;
    fixLoc;
    constructor(code, message, fix) {
        super(englishText(message));
        this.name = 'SdlcError';
        this.code = code;
        this.messageLoc = message;
        if (fix !== undefined) {
            this.fixLoc = fix;
            this.fix = englishText(fix);
        }
    }
    localizedMessage() {
        return localizedText(this.messageLoc) ?? this.message;
    }
    localizedFix() {
        return localizedText(this.fixLoc) ?? this.fix;
    }
}
export function toDiagnostic(error) {
    if (error instanceof SdlcError) {
        return {
            severity: 'error',
            code: error.code,
            message: error.message,
            ...(error.fix ? { fix: error.fix } : {}),
        };
    }
    return {
        severity: 'error',
        code: 'unexpected_error',
        message: error instanceof Error ? error.message : String(error),
    };
}
