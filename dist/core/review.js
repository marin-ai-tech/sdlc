const HEADING = /^###\s+(?:([A-Za-z]+-?\d+)\s+)?\[([A-Za-z][\w-]*)\]\s*(?:\[([A-Za-z][\w-]*)\]\s*)?(.+?)\s*$/;
const STATUS = /^\s*[-*]\s*\*\*Status\*\*\s*:\s*([A-Za-z-]+)(?:\s*\((D\d+)\))?/i;
const WHERE = /^\s*[-*]\s*\*\*Where\*\*\s*:\s*(.+)$/i;
function normalizeStatus(raw) {
    const s = (raw ?? '').toLowerCase();
    if (s === 'fixed' || s === 'resolved' || s === 'done')
        return 'fixed';
    if (s === 'accepted' || s === 'acknowledged' || s === 'deferred')
        return 'accepted';
    if (s === 'wontfix' || s === 'won-t-fix' || s === 'rejected' || s === 'invalid')
        return 'wontfix';
    return 'open';
}
export function parseFindings(content) {
    const lines = content.split(/\r?\n/);
    const findings = [];
    let current;
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line))
            inFence = !inFence;
        if (inFence)
            continue;
        const heading = line.match(HEADING);
        if (heading) {
            current = {
                ...(heading[1] ? { id: heading[1] } : {}),
                severity: heading[2].toLowerCase(),
                pass: (heading[3] ?? 'general').toLowerCase(),
                title: heading[4],
                status: 'open',
                line: i + 1,
            };
            findings.push(current);
            continue;
        }
        if (/^#{1,3}\s/.test(line)) {
            current = undefined;
            continue;
        }
        if (!current)
            continue;
        const status = line.match(STATUS);
        if (status) {
            current.status = normalizeStatus(status[1]);
            if (status[1].toLowerCase() === 'deferred') {
                if (status[2])
                    current.deferredTo = status[2];
                else
                    current.deferredUnlinked = true;
            }
        }
        const where = line.match(WHERE);
        if (where)
            current.where = where[1].trim();
    }
    return findings;
}
export function summarizeFindings(findings, blockOn) {
    const bySeverity = {};
    const byPass = {};
    const blocking = [];
    const blockSet = new Set(blockOn.map((s) => s.toLowerCase()));
    for (const f of findings) {
        const entry = (bySeverity[f.severity] ??= { total: 0, open: 0 });
        entry.total += 1;
        if (f.status === 'open')
            entry.open += 1;
        byPass[f.pass] = (byPass[f.pass] ?? 0) + 1;
        if (f.status === 'open' && blockSet.has(f.severity))
            blocking.push(f);
    }
    return {
        total: findings.length,
        open: findings.filter((f) => f.status === 'open').length,
        bySeverity,
        byPass,
        blocking,
    };
}
export function parseCoverage(content) {
    const entries = [];
    let inCoverage = false;
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (/^##\s+/.test(line)) {
            inCoverage = /^##\s+Coverage\s*$/i.test(line);
            continue;
        }
        if (/^#\s+/.test(line)) {
            inCoverage = false;
            continue;
        }
        if (!inCoverage)
            continue;
        const match = /^\s*[-*]\s+([a-z]+(?:-[a-z]+)*)\s*[:\-—]\s*(.*)$/i.exec(line);
        if (!match)
            continue;
        const name = match[1].toLowerCase();
        const value = match[2].trim();
        const count = /^(\d+)\s+findings?\b/i.exec(value);
        if (count)
            entries.push({ name, findings: Number(count[1]), line: index + 1 });
        else if (/^none found\b/i.test(value)) {
            const checked = /(?:^|[:\-—])\s*checked\s*:\s*(.*)$/i.exec(value);
            entries.push({ name, none: checked?.[1].trim() ?? '', line: index + 1 });
        }
    }
    return entries;
}
export function checkCoverage(findings, coverage, required) {
    const missing = [];
    const unchecked = [];
    const mismatched = [];
    for (const name of required) {
        const entry = coverage.find((item) => item.name === name);
        if (!entry) {
            missing.push(name);
            continue;
        }
        if (entry.none !== undefined && !entry.none.trim())
            unchecked.push(name);
        if (entry.findings !== undefined) {
            const actual = findings.filter((finding) => finding.pass === name).length;
            if (entry.findings !== actual)
                mismatched.push({ name, declared: entry.findings, actual });
        }
    }
    return { missing, unchecked, mismatched };
}
