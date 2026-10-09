/**
 * Open questions of an artifact (0.11.4, B62): the top-level list items (`- `, `* `, `1. `) under the
 * `## Open questions` heading, up to the next `## ` heading. Indented sub-items are not questions; an item that
 * says only "None", "Нет", "-" or "n/a" means there are none. HTML comments (template hints) are skipped.
 * The text of a question is the item text, trimmed, without its marker.
 */
// `## Open questions`, `### Open Questions (2):`, a Russian heading, or a bold label `**Open questions:**`.
const NAME = String.raw `(?:open questions|открытые вопросы)`;
const SECTION = new RegExp(String.raw `^#{1,3}\s+${NAME}\s*(?:\(\d+\))?\s*:?\s*$`, 'i');
const BOLD_SECTION = new RegExp(String.raw `^\*\*${NAME}\s*:?\*\*\s*:?\s*(.*)$`, 'i');
const NEXT_SECTION = /^#{1,6}\s/;
const BOLD_LABEL = /^\*\*[^*]+\*\*\s*:?/;
const FENCE = /^\s*(?:```|~~~)/;
const TOP_LEVEL_ITEM = /^(?:[-*]|\d+\.)\s+(.*)$/;
const NO_QUESTIONS = /^(?:none|нет|-|n\/a)\.?$/i;
const ANSWER_ITEM = /^\s+[-*]\s+Answer \(/;
/** The file's lines with every HTML comment blanked out, line for line. */
function visibleLines(text) {
    const blanked = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
    return blanked.split(/\r?\n/);
}
function isSectionStart(text) {
    return SECTION.test(text.trim()) || BOLD_SECTION.test(text.trim());
}
/** The line range [start, end) of the section's body; undefined without the heading. Fenced code does not end it. */
function sectionRange(lines) {
    const heading = lines.findIndex(isSectionStart);
    if (heading < 0)
        return undefined;
    let fence = false;
    for (let index = heading + 1; index < lines.length; index++) {
        if (FENCE.test(lines[index]))
            fence = !fence;
        if (!fence && (NEXT_SECTION.test(lines[index]) || BOLD_LABEL.test(lines[index].trim()))) {
            return { start: heading + 1, end: index };
        }
    }
    return { start: heading + 1, end: lines.length };
}
/** A question written on the bold label's own line (`**Open questions:** - Which DB?`). */
function inlineQuestion(lines, heading) {
    const rest = BOLD_SECTION.exec(lines[heading].trim())?.[1] ?? '';
    const item = TOP_LEVEL_ITEM.exec(rest.trim())?.[1]?.trim() ?? rest.trim();
    return item && !NO_QUESTIONS.test(item) ? item : undefined;
}
/** The questions of an artifact's text, numbered from 1. */
export function parseOpenQuestions(text) {
    const lines = visibleLines(text);
    const range = sectionRange(lines);
    if (!range)
        return [];
    const found = [];
    const inline = inlineQuestion(lines, range.start - 1);
    if (inline)
        found.push({ n: 1, text: inline, line: range.start - 1 });
    let fence = false;
    for (let index = range.start; index < range.end; index++) {
        if (FENCE.test(lines[index]))
            fence = !fence;
        if (fence)
            continue;
        const item = TOP_LEVEL_ITEM.exec(lines[index].trimEnd());
        const question = item?.[1].trim();
        if (!question || NO_QUESTIONS.test(question))
            continue;
        found.push({ n: found.length + 1, text: question, line: index });
    }
    return found;
}
/** The index right after the question's own sub-items (indented or blank lines that follow it). */
function subItemsEnd(lines, from) {
    let index = from + 1;
    while (index < lines.length && (lines[index].trim() === '' || /^\s/.test(lines[index])))
        index++;
    return index;
}
/** The answer line written under a question. */
export function answerLine(name, date, answer) {
    return `  - Answer (${name}, ${date}): ${answer}`;
}
/**
 * The text with `line` placed right under the question: it replaces an earlier `Answer (` sub-item of that
 * question, or is inserted after the question's line. The file's line endings are kept.
 */
export function withAnswer(text, question, line) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const end = subItemsEnd(lines, question.line);
    const earlier = lines.slice(question.line + 1, end).findIndex((item) => ANSWER_ITEM.test(item));
    if (earlier >= 0) {
        lines[question.line + 1 + earlier] = line;
    }
    else {
        lines.splice(question.line + 1, 0, line);
    }
    return lines.join(eol);
}
