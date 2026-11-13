import { writeSegments } from './policy-shell.js';
/** Preserve the guard's text boundaries for writes whose directory cannot be resolved. */
export function textPatterns(names) {
    const start = String.raw `(?:^|[\s'"=(,>])(?:\./)?`;
    const end = String.raw `(?=$|[\s'";&|),<>])`;
    return {
        text: new RegExp(`${start}(${names})${end}`, 'i'),
        varText: new RegExp(String.raw `\$(?:env:)?\{?\w+\}?(?:/)?(${names})${end}`, 'i'),
    };
}
/** Targets remain raw when their directory or a variable prefix prevents absolute resolution. */
function targets(segment) {
    return segment.redirects ?? segment.destinations ?? segment.words.slice(1);
}
function rootRelative(target, unknownDirectory) {
    const variable = /^(?:\$\{[A-Za-z_]\w*\}|\$(?:env:)?[A-Za-z_]\w*\/)(?:\/)?/i.exec(target);
    if (variable)
        return target.slice(variable[0].length).replace(/^\.\//, '').replace(/\\/g, '/');
    if (!unknownDirectory || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(target))
        return undefined;
    return target.replace(/^\.\//, '').replace(/\\/g, '/');
}
/** A root-relative protected name in a write with an unknown directory or a variable prefix. */
export function hiddenTargetHits(command, cwd, file, legacy) {
    const hits = [];
    for (const segment of writeSegments(command, cwd)) {
        for (const target of targets(segment)) {
            const rel = rootRelative(target, segment.dir === undefined);
            if (rel !== undefined && file.test(rel))
                hits.push(rel);
        }
        if (!legacy)
            continue;
        for (const text of segment.redirects ?? [segment.text]) {
            const spelled = segment.dir === undefined ? legacy.text.exec(text) : null;
            const match = legacy.varText.exec(text) ?? spelled;
            if (match)
                hits.push(match[1]);
        }
    }
    return hits;
}
