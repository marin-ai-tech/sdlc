const UNDEFINED = /(?<![\w$])undefined(?![\w$])/;
function undefinedOffsets(source) {
    const offsets = new Uint32Array(source.length + 1);
    for (const match of source.matchAll(new RegExp(UNDEFINED, 'g')))
        offsets[match.index + 1] = 1;
    for (let i = 1; i < offsets.length; i++)
        offsets[i] += offsets[i - 1];
    return offsets;
}
/** Index balanced patterns and same-depth delimiters once, including across ASI line breaks. */
function declarationIndex(source) {
    const end = new Uint32Array(source.length + 1).fill(source.length);
    const next = new Uint32Array(source.length + 1).fill(source.length);
    const scopes = [{ end: source.length, next: source.length }];
    for (let i = source.length - 1; i >= 0; i--) {
        const char = source[i];
        if (')]}'.includes(char))
            scopes.push({ end: i + 1, next: i });
        else if ('([{'.includes(char)) {
            end[i] = scopes.length > 1 ? scopes.pop().end : source.length;
        }
        else if (',;'.includes(char))
            scopes[scopes.length - 1].next = i;
        next[i] = scopes[scopes.length - 1].next;
    }
    return { end, next, undefinedAt: undefinedOffsets(source) };
}
function declarationShadows(source, start, index) {
    let at = start;
    while (at !== undefined) {
        while (/\s/.test(source[at] ?? ''))
            at++;
        const pattern = source[at] === '{' || source[at] === '[';
        const end = pattern ? index.end[at]
            : at + (/^[A-Za-z_$][\w$]*/.exec(source.slice(at))?.[0].length ?? 0);
        if (end === at || index.undefinedAt[end] > index.undefinedAt[at])
            return true;
        const delimiter = index.next[end];
        at = source[delimiter] === ',' ? delimiter + 1 : undefined;
    }
    return false;
}
/** Unknown binding patterns cannot establish the intrinsic value, even without a visible assignment. */
export function intrinsicUndefined(source, replaced) {
    if (replaced.has('undefined') || /\bclass\s+undefined(?![\w$])/.test(source))
        return false;
    const index = declarationIndex(source);
    for (const match of source.matchAll(/\b(?:const|let|var)\s+|\bcatch\s*(?=\()/g)) {
        const start = match.index + match[0].length;
        if (match[0].startsWith('catch')) {
            if (index.undefinedAt[index.end[start]] > index.undefinedAt[start])
                return false;
        }
        else if (declarationShadows(source, start, index))
            return false;
    }
    return true;
}
