/**
 * `lite` only for kind bugfix | refactor | chore | docs with risk low.
 * Everything else is `full`; security and incident changes and risk high are
 * always `full`, whatever else is true.
 */
export function suggestTrack(kind, risk) {
    if (risk === 'high')
        return { track: 'full', reasons: ['high risk requires the full track'] };
    if (kind === 'security' || kind === 'incident')
        return { track: 'full', reasons: [`${kind} changes require the full track`] };
    if (risk === 'low' && (kind === 'bugfix' || kind === 'refactor' || kind === 'chore' || kind === 'docs')) {
        return { track: 'lite', reasons: [`${kind} with low risk`] };
    }
    return { track: 'full', reasons: [`${kind} with ${risk} risk`] };
}
