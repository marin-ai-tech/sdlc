import { expandRefs } from './registry.js';
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** Resolve only this receiver's static arguments, immediately before its tool call. */
export function resolveEventArgs(args, env) {
    const missing = new Set();
    function resolve(value) {
        if (typeof value === 'string') {
            for (const match of value.matchAll(REFERENCE)) {
                if (env[match[1]] === undefined)
                    missing.add(match[1]);
            }
            return expandRefs(value, env);
        }
        if (Array.isArray(value))
            return value.map(resolve);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
        }
        return value;
    }
    const resolved = resolve(args);
    return { ...(missing.size === 0 ? { args: resolved } : {}), missing: [...missing] };
}
export function missingEventVariables(args, env) {
    return resolveEventArgs(args, env).missing;
}
