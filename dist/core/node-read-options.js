/** A readFile pathname is data only when its opening options cannot create or truncate it. */
export function readOnlyFileOpening(tail, intrinsicUndefined, pristinePrototype) {
    if (/^\s*\)/.test(tail))
        return true;
    if (/^\s*,\s*null(?=\s*[,)])/.test(tail))
        return true;
    if (/^\s*,\s*undefined(?=\s*[,)])/.test(tail))
        return intrinsicUndefined;
    if (/^\s*,\s*(['"`])[^'"`\\]*\1(?=\s*[,)])/.test(tail))
        return true;
    if (/^\s*,\s*(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(tail))
        return true;
    const object = /^\s*,\s*\{([^{}]*)\}(?=\s*[,)])/.exec(tail);
    if (!object)
        return false;
    const fields = object[1].split(',');
    // An own flag does not depend on mutable inherited opening defaults.
    const ownFlag = fields.some(field => /^\s*(?:flag|(['"])flag\1)\s*:/.test(field));
    return (pristinePrototype || ownFlag) && fields.every(field => readOnlyField(field, intrinsicUndefined));
}
function readOnlyField(field, intrinsicUndefined) {
    if (!field.trim())
        return true;
    const entry = /^\s*(?:(['"])(flag|encoding)\1|(flag|encoding))\s*:\s*(.*?)\s*$/.exec(field);
    if (!entry)
        return false;
    const key = entry[2] ?? entry[3];
    const value = entry[4];
    if (key === 'encoding') {
        if (value === 'undefined')
            return intrinsicUndefined;
        return /^(?:null|(['"`])[^'"`\\]*\1)$/.test(value);
    }
    // r+ permits writing through an open descriptor, but readFile itself only reads and closes it.
    return /^(?:0|(['"])(?:r|rs|sr)\+?\1)$/.test(value);
}
