function mapping(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** These are host contract positions. Plugin-owned nested data is never recursively rewritten. */
export function projectHookSubject(subject, name) {
    if (!mapping(subject))
        return subject;
    const projected = { ...subject };
    for (const field of ['task', 'bid']) {
        const contract = subject[field];
        if (!mapping(contract) || !mapping(contract.ext))
            continue;
        const ext = Object.hasOwn(contract.ext, name) ? { [name]: contract.ext[name] } : {};
        projected[field] = { ...contract, ext };
    }
    return projected;
}
