import * as fs from 'node:fs';
import * as path from 'node:path';
import { approvalTrailers } from './approval-hygiene.js';
import { allChanges, approvalSignature, approvalSites, trailerStatus, withAllowedSigners, } from './approval-signatures.js';
import { resolveChange } from './changes.js';
import { SdlcError } from './errors.js';
import { ensureDir, isWithin } from './fs-utils.js';
import { LOG_PATH, readLog } from './log.js';
import { readRolesFile } from './roles.js';
import { evidenceIndexMarkdown } from './evidence-index-md.js';
/** The folder name of a change inside the bundle: archived changes keep their archive folder name. */
export function bundleId(ref) {
    return ref.archivedAs ?? ref.id;
}
/** `dir` with links resolved: the real path of its nearest existing ancestor, joined with the rest of it. */
function realTarget(dir) {
    const rest = [];
    let at = dir;
    while (!fs.existsSync(at) && path.dirname(at) !== at) {
        rest.unshift(path.basename(at));
        at = path.dirname(at);
    }
    return path.join(fs.realpathSync(at), ...rest);
}
function insideOpenspec(dir, paths) {
    if (isWithin(paths.openspecDir, dir))
        return true;
    return isWithin(fs.realpathSync(paths.openspecDir), realTarget(dir));
}
/** Refuses a target that is a file, a non-empty folder, or lies inside openspec/ (the bundle never mixes in). */
export function assertExportTarget(dir, paths) {
    if (insideOpenspec(dir, paths)) {
        throw new SdlcError('invalid_option', { key: 'error.export_dir_inside_openspec', params: { dir } });
    }
    if (!fs.existsSync(dir))
        return;
    const stat = fs.statSync(dir);
    if (stat.isDirectory() && fs.readdirSync(dir).length === 0)
        return;
    throw new SdlcError('invalid_option', { key: 'error.export_dir_not_empty', params: { dir } }, { key: 'fix.export_dir_choose_new' });
}
function exportRefs(paths, change) {
    if (change === undefined)
        return allChanges(paths);
    return [resolveChange(paths, change, { allowArchived: true })];
}
function signingRoles(root) {
    const roles = readRolesFile(root);
    return roles && roles.signing !== 'off' ? roles : undefined;
}
function toExportApproval(site, signature, trailer) {
    const { ref, gate, record } = site;
    const approval = {
        change: bundleId(ref),
        gate,
        role: record.role,
        by: record.by,
        ...(record.person ? { person: record.person } : {}),
        at: record.at,
        digest: record.digest,
        signature,
        trailer,
    };
    return approval;
}
/** Every approval of `refs` with the status `sdlc approvals verify` computes, or `not-checked` without signing. */
export function exportApprovals(root, refs) {
    const sites = approvalSites(root, refs);
    const trailers = approvalTrailers(root);
    const trailerOf = (site) => trailerStatus(trailers, site.ref.id, site.gate, site.record.digest);
    const roles = signingRoles(root);
    if (!roles)
        return sites.map((site) => toExportApproval(site, 'not-checked', trailerOf(site)));
    return withAllowedSigners(roles, (signers) => sites.map((site) => {
        const signature = approvalSignature(root, roles, signers, site).status;
        return toExportApproval(site, signature, trailerOf(site));
    }));
}
/** A regular file with a single link whose real path stays inside `within`; links and anything else are skipped. */
function isPlainFileWithin(abs, within) {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.nlink > 1)
        return false;
    if (!isWithin(within, abs))
        return false;
    return isWithin(fs.realpathSync(within), fs.realpathSync(abs));
}
/** Files of a change folder, posix and relative to it; symbolic links (files or folders) are never followed. */
export function changeFolderFiles(changesDir, dir) {
    const out = [];
    const walk = (current, rel) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const abs = path.join(current, entry.name);
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory())
                walk(abs, childRel);
            else if (entry.isFile() && isPlainFileWithin(abs, changesDir))
                out.push(childRel);
        }
    };
    if (isWithin(changesDir, dir))
        walk(dir, '');
    return out.sort();
}
/** Writes a new file; fails rather than overwrite one that appeared meanwhile. */
function writeNew(target, content) {
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, content, { flag: 'wx' });
}
function copyChange(paths, ref, out) {
    const files = changeFolderFiles(paths.changesDir, ref.dir);
    for (const rel of files) {
        const target = path.join(out, 'changes', bundleId(ref), ...rel.split('/'));
        writeNew(target, fs.readFileSync(path.join(ref.dir, ...rel.split('/'))));
    }
    return files.length;
}
/** Project-log entries on or after `since` (all without it), only those of `change` when given. */
export function periodLog(root, since, change) {
    const from = since === undefined ? undefined : Date.parse(since);
    const file = path.join(root, LOG_PATH);
    if (fs.existsSync(file) && !isPlainFileWithin(file, path.join(root, 'openspec')))
        return [];
    return readLog(root).filter((entry) => {
        if (change && entry.change !== change.id)
            return false;
        if (from === undefined)
            return true;
        const at = Date.parse(entry.ts);
        return Number.isFinite(at) && at >= from;
    });
}
function buildIndex(project, refs, since) {
    return {
        generatedAt: new Date().toISOString(),
        ...(since ? { since } : {}),
        project: project.name,
        harness: project.stamp,
        changes: refs.map(bundleId),
        approvals: exportApprovals(project.root, refs),
    };
}
/** Writes the bundle into `opts.dir` (new or empty) and returns what it wrote. */
export function writeEvidenceBundle(project, opts) {
    const dir = path.resolve(opts.dir);
    assertExportTarget(dir, project.paths);
    const refs = exportRefs(project.paths, opts.change);
    const index = buildIndex(project, refs, opts.since);
    const log = periodLog(project.root, opts.since, opts.change === undefined ? undefined : refs[0]);
    ensureDir(dir);
    writeNew(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    writeNew(path.join(dir, 'index.md'), evidenceIndexMarkdown(index));
    writeNew(path.join(dir, 'log.jsonl'), log.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
    let files = 3;
    for (const ref of refs)
        files += copyChange(project.paths, ref, dir);
    return { dir, changes: refs.length, approvals: index.approvals.length, files };
}
