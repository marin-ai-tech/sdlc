/**
 * `sdlc guide` (0.9.1): short articles about working with sdlc, shipped in the package as
 * `assets/guide/<locale>/<topic>.md` (front matter `title`, `summary`; `##` sections), so they always match the
 * installed version. An article missing in the active locale falls back to English. JSON keys stay English.
 */
import * as path from 'node:path';
import { assetsDir, readAsset, splitFrontmatter } from '../integrations/assets.js';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
/** The topics in the order of the index. */
export const GUIDE_TOPICS = [
    'start', 'lifecycle', 'gates', 'roles', 'team', 'tracks', 'bugfix', 'backlog', 'rework', 'verify', 'review', 'health', 'mcp', 'config',
    'denials', 'faq',
];
/** The article of a topic in `locale`, else in English (a missing English article is a missing asset). */
function readArticle(topic, locale) {
    const local = readText(path.join(assetsDir(), 'guide', locale, `${topic}.md`));
    const found = local === undefined ? undefined : { locale, text: local.replace(/\r\n?/g, '\n') };
    const chosen = found ?? { locale: 'en', text: readAsset('guide', 'en', `${topic}.md`) };
    const { data, body } = splitFrontmatter(chosen.text);
    return { locale: chosen.locale, data, body };
}
function text(data, key) {
    return typeof data[key] === 'string' ? data[key] : '';
}
function unknownTopic(topic) {
    return new SdlcError('unknown_guide_topic', { key: 'error.unknown_guide_topic_x_topics_x', params: { topic: topic, topics: GUIDE_TOPICS.join(', ') } }, { key: 'fix.list_the_guide_topics' });
}
/** The index: every topic with the title and summary of its article. */
export function guideIndex(locale) {
    const topics = GUIDE_TOPICS.map((id) => {
        const { data } = readArticle(id, locale);
        return { id, title: text(data, 'title'), summary: text(data, 'summary') };
    });
    return { topics };
}
/** The lines of `## <name>` up to the next `##` heading (headings inside code fences do not count). */
export function guideSection(body, name) {
    const lines = body.split('\n');
    let fence = false;
    let start = -1;
    let end = lines.length;
    for (const [index, current] of lines.entries()) {
        if (current.startsWith('```'))
            fence = !fence;
        if (fence || !current.startsWith('## '))
            continue;
        if (start >= 0) {
            end = index;
            break;
        }
        if (current.slice(3).trim() === name)
            start = index;
    }
    if (start < 0)
        return undefined;
    return `${lines.slice(start, end).join('\n').trimEnd()}\n`;
}
/** One article (`topic`) or one of its sections (`topic#section`). */
export function guideArticle(request, locale) {
    const [topic, section] = request.split('#', 2);
    if (!GUIDE_TOPICS.includes(topic))
        throw unknownTopic(request);
    const article = readArticle(topic, locale);
    const title = text(article.data, 'title');
    if (section === undefined)
        return { topic, locale: article.locale, title, body: article.body };
    const body = guideSection(article.body, section);
    if (body === undefined)
        throw unknownTopic(request);
    return { topic, section, locale: article.locale, title, body };
}
