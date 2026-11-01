/** Small boundary readers shared by persisted decision records. */
export function recordObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : undefined;
}
export function stringList(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
export function stringFields(raw, required, optional = []) {
    return required.every((key) => typeof raw[key] === 'string')
        && optional.every((key) => raw[key] === undefined || typeof raw[key] === 'string');
}
