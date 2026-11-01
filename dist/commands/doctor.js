import { c, line, printJson, reportFailure } from '../cli/output.js';
import { doctorChecks } from '../core/doctor.js';
import { currentLocale, t } from '../core/i18n.js';
import { REQUIRED_NOTICE } from '../core/license.js';
import { findProjectRoot } from '../core/project.js';
import { doctorFix } from './doctor-fix.js';
import { loadConfig } from '../core/config.js';
import { configured, readRegistry } from '../plugins/trust.js';
import { invoke } from '../plugins/runtime.js';
import { readStore } from '../plugins/store.js';
import { fail, LIMITS, pluginDiagnostic } from '../plugins/api.js';
function printChecks(checks, loc) {
    line(c.dim(REQUIRED_NOTICE));
    for (const ch of checks) {
        const icon = ch.status === 'ok' ? c.green('✓') : ch.status === 'warn' ? c.yellow('!') : c.red('✗');
        line(`${icon} ${ch.check.padEnd(16)} ${ch.message}`);
        if (ch.fix && ch.status !== 'ok') {
            line(`  ${''.padEnd(16)} ${c.dim(t('doctor.fixLabel', { fix: ch.fix }, loc))}`);
        }
    }
}
/** After --fix: one line per repaired check, then the checks left to a person. */
function printFixes(result, loc) {
    line();
    if (result.fixed.length === 0)
        line(t('doctor.fixedNone', undefined, loc));
    for (const name of result.fixed)
        line(`${c.green('✓')} ${t('doctor.fixed', { check: name }, loc)}`);
    if (result.manual.length === 0)
        return;
    line(c.bold(t('doctor.leftToYou', undefined, loc)));
    for (const item of result.manual) {
        line(item.fix ? `  - ${item.name}: ${item.fix}` : `  - ${item.name}`);
    }
}
function runChecks(fix, loc) {
    const root = findProjectRoot();
    if (!fix)
        return { checks: doctorChecks({ root, locale: loc }) };
    const fixes = doctorFix(root, loc);
    return { checks: fixes.checks, fixes };
}
/** Metadata/config/state validation is bounded and never instantiates or calls a guest. */
async function runtimeChecks(root) {
    if (!root)
        return [];
    let config;
    try {
        config = loadConfig(`${root}/openspec/sdlc.yaml`);
    }
    catch {
        return [];
    }
    const checks = [];
    const deadline = performance.now() + LIMITS.operationMs;
    const budget = () => {
        const left = deadline - performance.now();
        if (left <= 0)
            fail('plugin_timeout', 'Plugin diagnostics deadline exceeded');
        return left;
    };
    for (const [name, setting] of Object.entries(config.plugins ?? {})) {
        if (!setting.enabled)
            continue;
        try {
            const { snapshot } = configured(root, config, name);
            await invoke(snapshot, { preflight: true, validate: { kind: 'config', value: setting.config },
                timeoutMs: budget() });
            const accepted = readRegistry(root).plugins[name];
            if (accepted) {
                const store = readStore(root, name, accepted.stateId);
                await invoke(snapshot, { preflight: true, validate: { kind: 'state', value: store.data },
                    timeoutMs: budget() });
            }
            checks.push({ check: `plugin runtime ${name}`, status: 'ok', message: 'Profile and declared configuration/state schemas are valid' });
        }
        catch (error) {
            const problem = pluginDiagnostic(error);
            checks.push({ check: `plugin runtime ${name}`, status: 'error', code: problem.code, message: problem.message,
                fix: `Inspect ${name}; a person repairs its pinned package, configuration or store.` });
        }
    }
    return checks;
}
export async function doctorCommand(opts) {
    try {
        // JSON payloads stay English in every locale; text uses the active locale.
        const loc = opts.json ? 'en' : currentLocale();
        const { checks, fixes } = runChecks(opts.fix, loc);
        checks.push(...await runtimeChecks(findProjectRoot()));
        const errors = checks.filter((ch) => ch.status === 'error').length;
        const fixJson = fixes ? { fixed: fixes.fixed, manual: fixes.manual } : {};
        if (opts.json)
            printJson({ healthy: errors === 0, checks, ...fixJson });
        else
            printChecks(checks, loc);
        if (!opts.json && fixes)
            printFixes(fixes, loc);
        if (errors > 0)
            process.exitCode = 1;
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
