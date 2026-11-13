import * as fs from 'node:fs';
import { parse } from 'yaml';
import { toDiagnostic } from './core/errors.js';
import { t } from './core/i18n.js';
function configLabel(file) {
    return file.replaceAll('\\', '/').split('/').slice(-2).join('/');
}
/** A failed config load can only honor an explicit YAML string `off`. */
export function configModeIsOff(file) {
    try {
        const raw = parse(fs.readFileSync(file, 'utf8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return false;
        const enforcement = raw.enforcement;
        if (!enforcement || typeof enforcement !== 'object' || Array.isArray(enforcement))
            return false;
        return enforcement.mode === 'off';
    }
    catch {
        return false;
    }
}
function loadDetail(file, error) {
    const diagnostic = toDiagnostic(error);
    return t('hook.configLoad', {
        file: configLabel(file), code: diagnostic.code, message: diagnostic.message,
        fix: diagnostic.fix ?? t('fix.configLoad'),
    });
}
export function configLoadDecision(file, error) {
    return { decision: 'deny', rule: 'config-load', reason: loadDetail(file, error) };
}
export function configLoadSessionLine(file, error) {
    const diagnostic = toDiagnostic(error);
    return t('session.configLoad', { file: configLabel(file), code: diagnostic.code });
}
export function configLoadStopMessage(file, error) {
    return t('hook.configLoadStop', { detail: loadDetail(file, error) });
}
