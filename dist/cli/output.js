import { SdlcError, toDiagnostic } from '../core/errors.js';
import { t } from '../core/i18n.js';
const useColor = () => !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
function wrap(code, reset) {
    return (text) => (useColor() ? `\x1b[${code}m${text}\x1b[${reset}m` : text);
}
export const c = {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    cyan: wrap(36, 39),
};
export function printJson(data) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
export function line(text = '') {
    process.stdout.write(`${text}\n`);
}
export function warn(text) {
    process.stderr.write(`${c.yellow(t('label.warning'))}: ${text}\n`);
}
/** Reports a failure in the requested mode and sets a non-zero exit code. */
export function reportFailure(error, json, nullShape = {}) {
    const diagnostic = toDiagnostic(error);
    if (json) {
        printJson({ ...nullShape, status: [diagnostic] });
    }
    else {
        const message = error instanceof SdlcError ? error.localizedMessage() : diagnostic.message;
        const fix = error instanceof SdlcError ? error.localizedFix() : diagnostic.fix;
        process.stderr.write(`${c.red(t('label.error'))}: ${message}\n`);
        if (fix)
            process.stderr.write(`${c.dim(t('label.fix'))}: ${fix}\n`);
    }
    process.exitCode = 1;
}
export function gateBadge(status) {
    const word = t(`gateStatus.${status}`);
    switch (status) {
        case 'approved':
        case 'passed':
            return c.green(`✓ ${word}`);
        case 'waived':
        case 'n/a':
            return c.dim(`~ ${word}`);
        case 'rejected':
        case 'failed':
            return c.red(`✗ ${word}`);
        case 'stale':
            return c.yellow(`↻ ${word}`);
        case 'pending':
            return c.yellow(`… ${word}`);
        default:
            return c.dim(`· ${word}`);
    }
}
