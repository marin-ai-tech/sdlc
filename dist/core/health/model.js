import { t } from '../i18n.js';
/**
 * The findings model of `sdlc health` (0.11.3, B65, B68): where the process and the practices suffer, each finding
 * with its facts and a recommended improvement. There is no single score. `title`, `facts` and `recommendation` are
 * English in JSON; text output renders the same catalog keys in the active locale.
 */
export const HEALTH_AREAS = ['flow', 'quality', 'discipline', 'config'];
export const HEALTH_LEVELS = ['bad', 'warn', 'info'];
export function findingKey(id) {
    return `health.${id}`;
}
/** The finding in a locale: English for JSON, the active locale for text. */
export function renderFinding(draft, locale) {
    const key = findingKey(draft.id);
    const params = draft.params ?? {};
    const recommendation = draft.recommendation ?? { key: `${key}.recommendation`, params };
    return {
        id: draft.id,
        area: draft.area,
        level: draft.level,
        title: t(`${key}.title`, params, locale),
        facts: draft.facts.map((fact) => t(fact.key, fact.params, locale)),
        recommendation: t(recommendation.key, recommendation.params, locale),
        key,
        params,
    };
}
function compareFindings(a, b) {
    const level = HEALTH_LEVELS.indexOf(a.level) - HEALTH_LEVELS.indexOf(b.level);
    if (level !== 0)
        return level;
    return a.id.localeCompare(b.id);
}
/** Bad, warn, info, then by id; a finding without facts is not listed. */
export function orderFindings(drafts) {
    const listed = drafts.filter((draft) => draft.facts.length > 0);
    return listed.sort(compareFindings);
}
export function countFindings(findings) {
    const counts = { info: 0, warn: 0, bad: 0 };
    for (const finding of findings)
        counts[finding.level] += 1;
    return counts;
}
