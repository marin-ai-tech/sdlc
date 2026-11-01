import { canonical, fail } from './api.js';
function scalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
function kind(value) { return value === null ? 'null' : typeof value; }
function leaves(predicate) {
    if ('all' in predicate)
        return predicate.all.flatMap(leaves);
    if ('any' in predicate)
        return predicate.any.flatMap(leaves);
    if ('not' in predicate)
        return leaves(predicate.not);
    return [predicate];
}
function validate(predicate, facts) {
    // Validate every leaf first: neither negation nor short circuit may turn unavailable facts into permission.
    for (const leaf of leaves(predicate)) {
        if (!Object.hasOwn(facts, leaf.fact))
            fail('plugin_fact_missing', `Required fact ${leaf.fact} is unavailable`);
        const actual = facts[leaf.fact];
        const expected = leaf.op === 'in' ? leaf.value : [leaf.value];
        if (!scalar(actual) || expected.some((value) => kind(value) !== kind(actual))) {
            fail('plugin_fact_type', `Required fact ${leaf.fact} has a different type`);
        }
        if (['lt', 'lte', 'gt', 'gte'].includes(leaf.op) && typeof actual !== 'number') {
            fail('plugin_fact_type', `Ordering fact ${leaf.fact} must be numeric`);
        }
    }
}
function matches(predicate, facts) {
    if ('all' in predicate)
        return predicate.all.every((item) => matches(item, facts));
    if ('any' in predicate)
        return predicate.any.some((item) => matches(item, facts));
    if ('not' in predicate)
        return !matches(predicate.not, facts);
    const actual = facts[predicate.fact];
    switch (predicate.op) {
        case 'eq': return canonical(actual) === canonical(predicate.value);
        case 'ne': return canonical(actual) !== canonical(predicate.value);
        case 'in': return predicate.value.some((value) => canonical(value) === canonical(actual));
        case 'lt': return actual < predicate.value;
        case 'lte': return actual <= predicate.value;
        case 'gt': return actual > predicate.value;
        case 'gte': return actual >= predicate.value;
    }
}
export function evaluatePolicies(policies, hook, facts) {
    const applicable = policies.filter((policy) => policy.hook === hook);
    for (const policy of applicable)
        validate(policy.require, facts);
    for (const policy of applicable) {
        if (!matches(policy.require, facts)) {
            const names = [...new Set(leaves(policy.require).map((leaf) => leaf.fact))].join(', ');
            return { policy: policy.id, code: 'policy_failed',
                message: `Policy ${policy.id} requires ${names}: ${policy.reason}`.slice(0, 500) };
        }
    }
    return undefined;
}
