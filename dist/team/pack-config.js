import { SdlcError } from '../core/errors.js';
import { ROLE_ID } from './role-file.js';
/** The git transports sdlc fetches with: https, http, ssh, git, file, or the scp-like `user@host:path`. */
const GIT_URL = /^(?:(?:https?|ssh|git|file):\/\/[^\s]+|[\w.-]+@[\w.-]+:[^\s]+)$/;
/** A tag, a branch or a commit: no leading `-`, no `..`, no spaces or shell characters. */
const GIT_REF = /^[A-Za-z0-9_][\w./-]*$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const SPEC_MAX = 300;
function invalid(key, where, extra = {}) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}
function field(raw, key, where) {
    const value = raw[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string' || value.trim() === '')
        throw invalid('error.x_must_be_a_non_empty_string', where);
    return value.trim();
}
function checked(value, where, ok) {
    const safe = ok && value.length <= SPEC_MAX && !value.startsWith('-') && !CONTROL.test(value);
    if (!safe)
        throw invalid('error.pack_x_not_accepted', where, { value: JSON.stringify(value.slice(0, 80)) });
    return value;
}
function gitPack(name, url, raw, at) {
    const ref = field(raw, 'ref', `${at}.ref`);
    if (ref === undefined)
        throw invalid('error.pack_x_needs_ref', at);
    const git = checked(url, `${at}.git`, GIT_URL.test(url));
    return { name, git, ref: checked(ref, `${at}.ref`, GIT_REF.test(ref) && !ref.includes('..')) };
}
function parsePack(value, at) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', at);
    const raw = value;
    const name = field(raw, 'name', `${at}.name`) ?? '';
    if (!ROLE_ID.test(name))
        throw invalid('error.pack_name_x_not_kebab', `${at}.name`, { name });
    const git = field(raw, 'git', `${at}.git`);
    const npm = field(raw, 'npm', `${at}.npm`);
    if ((git === undefined) === (npm === undefined))
        throw invalid('error.pack_x_git_or_npm', at);
    if (git !== undefined)
        return gitPack(name, git, raw, at);
    const spec = npm ?? '';
    if (!validNpmSpec(spec) || spec.length > SPEC_MAX || spec.startsWith('-') || CONTROL.test(spec)) {
        throw invalid('error.pack_npm_source', `${at}.npm`);
    }
    return { name, npm: spec };
}
/** `packs`: absent = none. Each entry checked; a name used twice is a config error naming it. */
export function parsePacksConfig(value, where) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw invalid('error.x_must_be_a_list', where('packs'));
    const packs = value.map((item, index) => parsePack(item, where(`packs[${index}]`)));
    const seen = new Set();
    for (const pack of packs) {
        if (seen.has(pack.name))
            throw invalid('error.pack_name_x_twice', where('packs'), { name: pack.name });
        seen.add(pack.name);
    }
    return packs;
}
export function isGitPack(pack) {
    return 'git' in pack;
}
const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function validNpmSpec(spec) {
    const versionAt = spec.lastIndexOf('@');
    const scoped = spec.startsWith('@');
    const cut = versionAt > (scoped ? 0 : -1) ? versionAt : -1;
    const name = cut === -1 ? spec : spec.slice(0, cut);
    const version = cut === -1 ? '' : spec.slice(cut + 1);
    if (NPM_NAME.test(name) && (cut === -1 || /^[^@/:\s]+$/.test(version)))
        return true;
    if (/^https:\/\/[^\s]+\.(?:tgz|tar\.gz)$/.test(spec))
        return true;
    const localPath = /^(?:[A-Za-z]:[\\/])?[^:\s]+\.(?:tgz|tar\.gz)$/.test(spec);
    return localPath && !spec.startsWith('//');
}
/**
 * True when an npm spec names a registry package without an exact version (a bare name, a range or a dist-tag):
 * what it brings can change without the config changing. Paths, tarballs and git specs are not registry names.
 */
export function npmSpecFloats(spec) {
    const at = spec.lastIndexOf('@');
    const scoped = spec.startsWith('@');
    const cut = at > (scoped ? 0 : -1) ? at : -1;
    const name = cut === -1 ? spec : spec.slice(0, cut);
    if (!NPM_NAME.test(name))
        return false;
    return cut === -1 || !EXACT.test(spec.slice(cut + 1));
}
