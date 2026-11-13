export const NULL_SINKS = /^(?:\/dev\/null|\$null|nul)$/i;
const DESCRIPTOR = /^&(?:\d+|-)$/;
export function harmlessRedirect(target) {
    return NULL_SINKS.test(target) || DESCRIPTOR.test(target);
}
/** A redirect target that may safely be omitted from path checks on every shell. */
export function harmlessRedirectPath(target) {
    return /^\/dev\/null$/i.test(target) || DESCRIPTOR.test(target);
}
/** Remove only complete harmless output redirects, preserving all other write operators. */
export function withoutHarmlessRedirects(command) {
    let raw = command.raw;
    // `git &>/dev/null checkout x` splits at the `&`, so this part has lost its program: nothing here proves a read.
    if (command.words[0]?.operator)
        return raw;
    const spans = [];
    for (let i = 0; i < command.words.length - 1; i += 1) {
        const operator = command.words[i];
        const target = command.words[i + 1];
        if (!operator.operator || operator.value !== '>' || !harmlessRedirect(target.value))
            continue;
        let start = operator.start;
        const adjacent = command.raw.slice(0, start - command.start).match(/(?:\d+|\*)$/);
        if (adjacent)
            start -= adjacent[0].length;
        spans.push([start - command.start, target.end - command.start]);
    }
    for (const [start, end] of spans.reverse())
        raw = raw.slice(0, start) + raw.slice(end);
    return raw;
}
