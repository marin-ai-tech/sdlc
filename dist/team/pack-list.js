import { contentsReport, fetchedCopy } from './pack-effect.js';
function sourceOf(pack) {
    return 'git' in pack ? `git ${pack.git} ${pack.ref}` : `npm ${pack.npm}`;
}
function item(root, pack) {
    const base = { name: pack.name, source: sourceOf(pack), lenses: [], workflows: [], checks: [], problems: [] };
    const fetched = fetchedCopy(root, pack);
    if (!fetched)
        return { ...base, synced: false, inEffect: false };
    const report = contentsReport(root, pack, fetched);
    if (!report)
        return { ...base, synced: true, inEffect: false };
    const { lenses, workflows, checks, problems, accepted } = report;
    return { ...base, synced: true, inEffect: accepted, lenses, workflows, checks, problems };
}
/** Every pack of the config, in its order. */
export function listPacks(root, config) {
    return (config.packs ?? []).map((pack) => item(root, pack));
}
