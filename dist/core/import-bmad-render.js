import * as path from 'node:path';
export function section(map, name) {
    return [...map].find(([key]) => key.toLowerCase().startsWith(name.toLowerCase()))?.[1] ?? '';
}
export function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capability';
}
export function note(doc) {
    return ['<!-- Imported from BMAD: ' + path.basename(doc.path) + '. Review before approval. -->', '', ''].join('\n');
}
export function renderIntent(title, prd, spec) {
    const vision = section(prd, 'Vision');
    const why = section(spec, 'Why') || vision;
    const scope = section(prd, 'MVP Scope');
    const excluded = scope.match(/### .*Out of Scope[^\n]*\n([\s\S]*?)(?=### |$)/i)?.[1];
    const outOfScope = [section(prd, 'Non-Goals'), excluded, section(spec, 'Non-goals')].filter(Boolean).join('\n\n');
    return [
        '# Intent: ' + title, '', 'Status: draft. Source: BMAD.', '',
        '## Problem', vision || why, '', '## Proposed outcome', vision || why, '',
        '## Affected users and systems', section(prd, 'Target User') || section(spec, 'Capabilities'), '',
        '## Constraints', section(spec, 'Constraints'), '', '## Success measures',
        section(prd, 'Success Metrics') || section(spec, 'Success signal'), '',
        '## Out of scope', outOfScope, '', '## Open questions',
        section(prd, 'Open Questions') || section(spec, 'Open Questions'),
    ].join('\n');
}
export function renderProposal(why, requirements, groups) {
    const changes = requirements.map((item) => '- ' + item.id + ': ' + item.intent);
    const capabilities = [...groups].map(([group, items]) => '- `' + group + '`: ' + items.map((item) => item.name).join(', '));
    return [
        '# Proposal', '', '## Why', why, '', '## What Changes', ...changes, '',
        '## Capabilities', '', '### New Capabilities', ...capabilities, '',
        '## Impact', 'Imported BMAD planning draft.',
    ].join('\n');
}
function renderScenario(req, success, index) {
    return [
        '#### Scenario: ' + req.id + ' ' + (index + 1),
        '- **WHEN** ' + req.intent,
        '- **THEN** ' + success,
    ].join('\n');
}
export function renderDelta(title, items) {
    const lines = [
        '# Spec Delta', '', '## Purpose',
        'Imported BMAD capability covering ' + items.map((item) => item.name).join(', ') + ' for ' + title + '.',
        '', '## ADDED Requirements', '',
    ];
    for (const item of items) {
        lines.push('### Requirement: ' + item.name);
        lines.push('The system SHALL ' + item.intent.replace(/^[A-Z]/, (letter) => letter.toLowerCase()));
        lines.push('', 'Traceability: ' + item.id, '');
        const outcomes = item.successes.length ? item.successes : [item.intent];
        outcomes.forEach((success, index) => lines.push(renderScenario(item, success, index), ''));
    }
    return lines.join('\n');
}
export function renderDesign(architecture, body) {
    const decisions = [...body.matchAll(/^### (AD-\d+ .+)$\n([\s\S]*?)(?=^### |^## |$)/gm)];
    const decisionText = decisions.map((match) => [match[1], match[2]].join('\n')).join('\n\n');
    return [
        '# Design', '', '## Context', section(architecture, 'Design Paradigm'),
        '', '## Decisions', decisionText, '', '## Stack', section(architecture, 'Stack'),
    ].join('\n');
}
