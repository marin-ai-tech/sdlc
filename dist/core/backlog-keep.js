const documents = new WeakMap();
const items = new WeakMap();
const epics = new WeakMap();
/** Starts the record for a parsed backlog. */
export function keepDocument(backlog) {
    const kept = { preamble: [], headerEnd: 0, unassigned: [], sections: [] };
    documents.set(backlog, kept);
    return kept;
}
/** Starts the record for a parsed item; returns the list its unparsed lines go to. */
export function keepItem(item, statusText) {
    const kept = statusText === undefined ? { lines: [] } : { lines: [], statusText };
    items.set(item, kept);
    return kept.lines;
}
/** Starts the record for a parsed epic; returns the list its unparsed lines go to. */
export function keepEpic(epic) {
    const lines = [];
    epics.set(epic, lines);
    return lines;
}
function withoutTrailingBlanks(lines) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) {
        end--;
    }
    return lines.slice(0, end);
}
export function keptDocument(backlog) {
    return documents.get(backlog);
}
/** Text between the header and the first section. */
export function keptPreamble(kept) {
    if (!kept) {
        return [];
    }
    const body = kept.preamble.filter((line, index) => index >= kept.headerEnd || line.trim() !== '');
    return withoutTrailingBlanks(body);
}
/** Lines under an epic heading (other than `Goal:`), or under Unassigned when `epic` is undefined. */
export function keptSectionLines(kept, epic) {
    const lines = epic ? epics.get(epic) : kept?.unassigned;
    return withoutTrailingBlanks(lines ?? []);
}
/** Lines under an item that are not its known fields, in file order. */
export function keptItemLines(item) {
    return withoutTrailingBlanks(items.get(item)?.lines ?? []);
}
/** The status text for the item heading: an unknown text stays until a CLI command sets a status. */
export function headingStatus(item) {
    const statusText = items.get(item)?.statusText;
    return statusText !== undefined && item.status === 'open' ? statusText : item.status;
}
/** The extra `##` sections, each after a blank line, for the end of the file. */
export function keptSectionsAtEnd(kept) {
    const lines = [];
    for (const section of kept?.sections ?? []) {
        lines.push('', section.heading, ...withoutTrailingBlanks(section.lines));
    }
    return lines;
}
