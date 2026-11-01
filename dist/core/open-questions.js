/**
 * Open questions of an artifact (0.11.4, B62): the top-level list items (`- `, `* `, `1. `) under the
 * `## Open questions` heading, up to the next `## ` heading. Indented sub-items are not questions; an item that
 * says only the catalog's no-questions value, "-" or "n/a" means there are none. HTML comments are skipped.
 * The text of a question includes its continuation paragraphs, trimmed and joined without the list marker.
 */
import { installedLocales, catalog } from './i18n.js';
/** Headings supplied by installed catalogs. */
function headingPattern() {
    const headings = installedLocales().map((locale) => catalog(locale)['openQuestions.heading'])
        .filter((heading) => Boolean(heading));
    return `(?:${headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
}
function sectionPattern() {
    return new RegExp(`^#{1,3}\\s+${headingPattern()}\\s*(?:\\(\\d+\\))?\\s*:?\\s*$`, 'i');
}
function boldPattern() {
    return new RegExp(`^\\*\\*${headingPattern()}\\s*:?\\*\\*\\s*:?\\s*(.*)$`, 'i');
}
const NEXT_SECTION = /^#{1,6}\s/;
const BOLD_LABEL = /^\*\*[^*]+\*\*\s*:?/;
const FENCE = /^\s*(?:```|~~~)/;
const TOP_LEVEL_ITEM = /^(?:[-*]|\d+\.)\s+(.*)$/;
function noQuestions(text) {
    if (/^(?:-|n\/a)\.?$/i.test(text))
        return true;
    return installedLocales().some((locale) => {
        const value = catalog(locale)['openQuestions.none'];
        return value !== undefined && text.replace(/\.$/, '').toLowerCase() === value.toLowerCase();
    });
}
const ANSWER_ITEM = /^\s+[-*]\s+Answer \(/;
/** The file's lines with every HTML comment blanked out, line for line. */
function visibleLines(text) {
    const blanked = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
    return blanked.split(/\r?\n/);
}
function isSectionStart(text) {
    return sectionPattern().test(text.trim()) || boldPattern().test(text.trim());
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
    const rest = boldPattern().exec(lines[heading].trim())?.[1] ?? '';
    const item = TOP_LEVEL_ITEM.exec(rest.trim())?.[1]?.trim() ?? rest.trim();
    return item && !noQuestions(item) ? item : undefined;
}
/** Continuation paragraphs belong to the question; nested lists and recorded answers do not. */
function completeQuestion(lines, from, end, first) {
    const parts = [first];
    let fence = false;
    let nested;
    let separated = false;
    for (let index = from + 1; index < end; index++) {
        const text = lines[index];
        if (FENCE.test(text)) {
            fence = !fence;
            continue;
        }
        if (fence)
            continue;
        if (TOP_LEVEL_ITEM.test(text))
            break;
        if (!text.trim()) {
            separated = true;
            continue;
        }
        const item = /^(\s+)(?:[-*+]|\d+[.)])\s/.exec(text);
        if (item) {
            nested = item[1].length;
            separated = false;
            continue;
        }
        const indent = /^\s*/.exec(text)[0].length;
        if (nested !== undefined && (!separated || indent > nested))
            continue;
        nested = undefined;
        separated = false;
        parts.push(text.trim());
    }
    return parts.join(' ');
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
        found.push({ n: 1,
            text: completeQuestion(lines, range.start - 1, range.end, inline), line: range.start - 1 });
    let fence = false;
    for (let index = range.start; index < range.end; index++) {
        if (FENCE.test(lines[index]))
            fence = !fence;
        if (fence)
            continue;
        const item = TOP_LEVEL_ITEM.exec(lines[index].trimEnd());
        const question = item?.[1].trim();
        if (!question || noQuestions(question))
            continue;
        found.push({ n: found.length + 1, text: completeQuestion(lines, index, range.end, question), line: index });
    }
    return found;
}
/** The index right after the question's own sub-items (indented or blank lines that follow it). */
function subItemsEnd(lines, from) {
    let index = from + 1;
    let fence = false;
    while (index < lines.length) {
        if (FENCE.test(lines[index]))
            fence = !fence;
        if (!fence && (TOP_LEVEL_ITEM.test(lines[index]) || NEXT_SECTION.test(lines[index])
            || BOLD_LABEL.test(lines[index].trim())))
            break;
        index++;
    }
    return index;
}
/** The answer line written under a question. */
export function answerLine(name, date, answer) {
    return `  - Answer (${name}, ${date}): ${answer}`;
}
/**
 * The text with `line` placed right under the question: it replaces an earlier `Answer (` sub-item of that
 * question, or is inserted after its complete continuation and subitems. The file's line endings are kept.
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
        let insert = end;
        while (insert > question.line + 1 && lines[insert - 1].trim() === '')
            insert--;
        lines.splice(insert, 0, line);
    }
    return lines.join(eol);
}
