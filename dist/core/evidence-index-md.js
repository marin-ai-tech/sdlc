/**
 * `index.md` of an evidence bundle (B21): the same content as index.json, readable, one table per change. The
 * bundle is for auditors and stays English in every locale, like the JSON payloads.
 */
const HEADER = '| Gate | Role | By | At | Digest | Signature | Trailer |';
const RULE = '| --- | --- | --- | --- | --- | --- | --- |';
function cell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
function row(approval) {
    const by = approval.person ? `${approval.by} (${approval.person})` : approval.by;
    const cells = [approval.gate, approval.role, by, approval.at, approval.digest, approval.signature, approval.trailer];
    return `| ${cells.map(cell).join(' | ')} |`;
}
function changeSection(change, approvals) {
    const own = approvals.filter((approval) => approval.change === change);
    const lines = ['', `## ${change}`, '', `Files: changes/${change}/`, ''];
    if (own.length === 0) {
        lines.push('No approvals recorded.');
        return lines;
    }
    lines.push(HEADER);
    lines.push(RULE);
    for (const approval of own)
        lines.push(row(approval));
    return lines;
}
function headLines(index) {
    const period = index.since ? `since ${index.since}` : 'all time';
    return [
        `# Evidence bundle: ${index.project}`,
        '',
        `Generated: ${index.generatedAt} with sdlc ${index.harness.version} (${index.harness.license}).`,
        `Log period: ${period} (log.jsonl).`,
        `Changes: ${index.changes.length}. Approvals: ${index.approvals.length}.`,
        'Signature: the status `sdlc approvals verify` computes; not-checked when roles.yaml has no signing mode.',
        'Trailer: whether the approval commit trailer (SDLC-Approval) is reachable from HEAD.',
    ];
}
export function evidenceIndexMarkdown(index) {
    const lines = headLines(index);
    if (index.changes.length === 0) {
        lines.push('');
        lines.push('No changes.');
    }
    for (const change of index.changes)
        lines.push(...changeSection(change, index.approvals));
    return `${lines.join('\n')}\n`;
}
