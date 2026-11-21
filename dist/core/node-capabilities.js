function declared(spans, index) {
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (spans[middle].end <= index)
            low = middle + 1;
        else
            high = middle;
    }
    return low < spans.length && spans[low].start <= index;
}
/** Namespace values are not data: their functions may run through callbacks, coercion or computed access. */
export function namespaceEscape(source, bindings, calls) {
    const receivers = new Set(calls.filter(call => call.file && call.understood).map(call => call.receiverAt));
    const spans = bindings.declarations;
    if (calls.some(call => call.module && !receivers.has(call.index) && !declared(spans, call.index)))
        return true;
    const executable = source.replace(/['"](?:node:)?fs(?:\/promises)?['"]/g, text => ' '.repeat(text.length));
    for (const match of executable.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
        if (!bindings.namespaces.has(match[1]) || declared(spans, match.index) || receivers.has(match.index))
            continue;
        let before = match.index;
        while (before > 0 && /\s/.test(source[before - 1]))
            before--;
        if (source[before - 1] !== '.' || source[before - 2] === '.')
            return true;
    }
    return false;
}
