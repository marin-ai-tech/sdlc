import { SdlcError } from '../core/errors.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import { readPackContents } from './pack-contents.js';
import { fetchedCopy } from './pack-effect.js';
import { readTeam, TEAM_PATH, writeTeam } from './record.js';
function unknownPack(name, config) {
    const list = (config.packs ?? []).map((pack) => pack.name).join(', ') || '-';
    return new SdlcError('unknown_pack', { key: 'error.unknown_pack_x', params: { name, list } }, { key: 'fix.declare_the_pack_under_packs' });
}
function notSynced(name) {
    return new SdlcError('pack_not_synced', { key: 'error.pack_x_not_synced', params: { name } }, { key: 'fix.run_sdlc_team_sync_then_accept_pack', params: { name } });
}
function refused(name, problem) {
    const params = { name, item: problem.item, detail: problem.detail };
    return new SdlcError(problem.code, { key: `error.${problem.code}`, params }, { key: `fix.${problem.code}`, params });
}
function entryFor(contents, source, by) {
    return {
        digest: contents.digest,
        source,
        lenses: contents.lenses.map((lens) => lens.id),
        workflows: contents.workflows.map((workflow) => workflow.name),
        checks: contents.checks.map((check) => check.name),
        by,
        at: new Date().toISOString(),
    };
}
/** Records the person's acceptance of the pack's current contents and regenerates the files. */
export function acceptPack(root, config, name, by) {
    const pack = (config.packs ?? []).find((item) => item.name === name);
    if (!pack)
        throw unknownPack(name, config);
    const fetched = fetchedCopy(root, pack);
    if (!fetched)
        throw notSynced(name);
    const contents = readPackContents(fetched.dir, pack);
    if (contents.problems.length > 0)
        throw refused(name, contents.problems[0]);
    const team = readTeam(root);
    const entry = entryFor(contents, fetched.source, by);
    team.packs = { ...(team.packs ?? {}), [name]: entry };
    writeTeam(root, team);
    const files = refreshGeneratedFiles(root, config);
    const checks = contents.checks.map((check) => ({ name: check.name, run: check.run }));
    const { lenses, workflows, digest } = entry;
    return { pack: name, source: fetched.source, digest, lenses, workflows, checks, team: TEAM_PATH, files };
}
