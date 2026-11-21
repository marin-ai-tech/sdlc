import { HUMAN_COMMANDS } from '../core/human-commands.js';
import { callsHumanCommand, CLI_PREFIX, joinContinuations } from '../core/human-command-match.js';
const GLOBAL_OPTIONS = String.raw `(?:\s+--?[a-z][\w-]*(?:=[^\s;&|]+|\s+[^\s;&|-][^\s;&|]*)?)*`;
const PREFIX = `${CLI_PREFIX}${GLOBAL_OPTIONS}\\s+`;
const names = HUMAN_COMMANDS.map(name => name.split(' ').join('\\s+')).join('|');
const HUMAN_MENTION = new RegExp(`${PREFIX}(?:${names})\\b`, 'i');
const ADOPT_APPLY = new RegExp(`${PREFIX}adopt\\b[^;&|\\r\\n]*--apply\\b`, 'i');
const INIT_ROLES = new RegExp(`${PREFIX}init\\b[^;&|\\r\\n]*--roles\\b`, 'i');
function* codeSpans(text) {
    const markers = /`+/g;
    for (let match = markers.exec(text); match; match = markers.exec(text)) {
        const start = markers.lastIndex;
        const end = text.indexOf(match[0], start);
        if (end < 0)
            continue;
        markers.lastIndex = end + match[0].length;
        yield text.slice(start, end);
    }
}
/** Pack workflows are instructions: vet text mentions and decode their Markdown command snippets. */
export function workflowCallsHumanCommand(text) {
    const normalized = joinContinuations(text);
    if (HUMAN_MENTION.test(normalized) || ADOPT_APPLY.test(normalized) || INIT_ROLES.test(normalized))
        return true;
    if (callsHumanCommand(normalized))
        return true;
    for (const code of codeSpans(normalized)) {
        if (callsHumanCommand(code) || code.split('\n').some(callsHumanCommand))
            return true;
    }
    return false;
}
