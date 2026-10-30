import { toDiagnostic } from './errors.js';
import { evaluateChange } from './lifecycle.js';
/** A bad change is reported once and cannot contribute work to a shared view. */
export function evaluateEach(root, refs, config, options = {}) {
    const evaluated = [];
    const errors = [];
    for (const ref of refs) {
        try {
            evaluated.push({ ref, view: evaluateChange(root, ref, config, options) });
        }
        catch (error) {
            const diagnostic = toDiagnostic(error);
            errors.push({ change: ref.id, code: diagnostic.code, message: diagnostic.message });
        }
    }
    return { evaluated, errors };
}
