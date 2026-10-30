import { LIMITS, fail, json, keys, object, pluginDiagnostic } from './api.js';
import { activePlugins } from './catalog.js';
import { invoke } from './runtime.js';
import { evaluatePolicies } from './policy.js';
function decision(raw, plugin) {
    const value = object(raw, 'hook output');
    keys(value, ['decision', 'code', 'message'], 'hook output');
    if (typeof value.decision !== 'string' || !['pass', 'signal', 'deny'].includes(value.decision)) {
        fail('plugin_hook', 'Unknown hook decision');
    }
    if (value.code !== undefined && (typeof value.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.code))) {
        fail('plugin_hook', 'Invalid bounded hook code');
    }
    if (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 500)) {
        fail('plugin_hook', 'Invalid bounded hook diagnostic');
    }
    const code = value.code;
    const message = value.message;
    return { decision: value.decision, ...(code ? { code } : {}), ...(message ? { message } : {}),
        plugin: { name: plugin.snapshot.manifest.name, version: plugin.snapshot.manifest.version,
            digest: plugin.snapshot.digest, code: code ?? String(value.decision), ...(message ? { message } : {}) } };
}
/** Only pure operations run here; invocation-scoped facts never become core proof. */
export async function evaluateHooks(root, config, hook, subject, actor, captured, deadline = performance.now() + LIMITS.operationMs) {
    const plugins = captured ?? activePlugins(root, config);
    const facts = Object.create(null);
    let verdict = { decision: 'pass' };
    for (const plugin of [...plugins].sort((a, b) => a.snapshot.manifest.name.localeCompare(b.snapshot.manifest.name))) {
        const operation = plugin.snapshot.manifest.hooks[hook];
        if (!operation)
            continue;
        const remaining = deadline - performance.now();
        if (remaining <= 0)
            fail('plugin_timeout', 'Aggregate hook preparation deadline exceeded');
        try {
            const response = (await invoke(plugin.snapshot, { operation, input: json({ hook, subject }), hook: true,
                config: plugin.setting.config, state: plugin.store.data, revision: plugin.store.revision, context: json({ actor }),
                timeoutMs: Math.min(LIMITS.hookMs, remaining) }));
            const next = decision(response.output, plugin);
            if (next.decision === 'deny' && verdict.decision !== 'deny'
                || next.decision === 'signal' && verdict.decision === 'pass')
                verdict = next;
            for (const [name, value] of Object.entries(response.facts ?? {})) {
                if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
                    fail('plugin_fact', 'Invalid fact name');
                facts[`${plugin.snapshot.manifest.name}.${name}`] = value;
            }
        }
        catch (error) {
            if (hook !== 'result_accept')
                throw error;
            const diagnostic = pluginDiagnostic(error);
            return { verdict: { decision: 'deny', fault: true,
                    plugin: { name: plugin.snapshot.manifest.name, version: plugin.snapshot.manifest.version,
                        digest: plugin.snapshot.digest, code: diagnostic.code, message: diagnostic.message.slice(0, 500) } }, facts, plugins };
        }
    }
    const policy = evaluatePolicies(config.pluginPolicies ?? [], hook, facts);
    if (policy && verdict.decision !== 'deny')
        verdict = { decision: 'deny', ...policy };
    return { verdict, facts, plugins };
}
