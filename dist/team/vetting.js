import { createHash } from 'node:crypto';
import { ROLE_ID } from './role-file.js';
/** Limits on what a registry may hand over. */
export const LIMITS = { roleBytes: 256 * 1024, fileBytes: 256 * 1024, files: 64, skillBytes: 1024 * 1024 };
/** Skill names starting with `sdlc-` are the generated workflow skills: a registry may not take their place. */
const RESERVED_SKILL = /^sdlc(?:-|$)/;
const PATH_MAX = 200;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;
export function sha256Of(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
export function roleChecksum(body) {
    return sha256Of(body);
}
/** Files sorted by path (`localeCompare` in `en`), each `<path>\n<content>\n`, concatenated, hashed. */
export function skillChecksum(files) {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
    return sha256Of(sorted.map((file) => `${file.path}\n${file.content}\n`).join(''));
}
/** Why `rel` may not be a file of a skill folder (absolute, a drive, `..`, a backslash...), or undefined when safe. */
export function unsafeSkillPath(rel) {
    if (rel.length === 0 || rel.length > PATH_MAX)
        return 'empty or too long';
    if (/[\\\0:]/.test(rel) || /[\x00-\x1f]/.test(rel))
        return 'backslash, colon or control character';
    if (rel.startsWith('/') || rel.startsWith('~'))
        return 'absolute path';
    const parts = rel.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..'))
        return 'empty, `.` or `..` segment';
    if (parts.some((part) => /[. ]$/.test(part)))
        return 'a segment ends with a dot or a space';
    if (parts.some((part) => WINDOWS_DEVICE.test(part)))
        return 'a Windows device name';
    return undefined;
}
export function isMarkdown(rel) {
    return /\.md$/i.test(rel);
}
/** The files of a skill that are not Markdown (scripts, binaries): they wait for a person. */
export function scriptsOf(files) {
    return files.map((file) => file.path).filter((rel) => !isMarkdown(rel)).sort();
}
export function isSkillId(id) {
    return ROLE_ID.test(id) && !RESERVED_SKILL.test(id);
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function strings(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}
function str(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
const bytes = (text) => Buffer.byteLength(text, 'utf8');
function roleShape(raw, id) {
    const version = str(raw.version);
    const body = typeof raw.body === 'string' ? raw.body : undefined;
    const checksum = str(raw.checksum);
    if (raw.id !== id)
        return { reason: `answer is for another id (${String(raw.id)})` };
    if (!version || body === undefined || !checksum)
        return { reason: 'version, body or checksum missing' };
    if (version.length > 64 || !/^[\w.+-]+$/.test(version))
        return { reason: 'version is not a plain version string' };
    const skills = strings(raw.skills ?? []);
    if (!skills || skills.some((skill) => !isSkillId(skill)))
        return { reason: 'skills must be skill ids' };
    const role = {
        id, version, body, checksum, skills, title: str(raw.title) ?? id, stages: strings(raw.stages) ?? [],
        tools: strings(raw.tools) ?? [], readonly: raw.readonly !== false,
    };
    return { ok: role };
}
/** A `get_role` answer for `id`, checked: shape, size and checksum (also against what `list_roles` listed). */
export function vetRole(answer, id, listed) {
    const raw = record(answer);
    if (!raw)
        return { reason: 'answer is not an object' };
    const shaped = roleShape(raw, id);
    if (!('ok' in shaped))
        return shaped;
    const role = shaped.ok;
    if (bytes(role.body) > LIMITS.roleBytes)
        return { reason: `body larger than ${LIMITS.roleBytes} bytes` };
    const actual = roleChecksum(role.body);
    if (actual !== role.checksum)
        return { reason: `checksum mismatch: the body hashes to ${actual}` };
    if (typeof listed === 'string' && listed !== role.checksum)
        return { reason: 'checksum differs from list_roles' };
    return { ok: role };
}
function vetFiles(value) {
    if (!Array.isArray(value) || value.length === 0)
        return { reason: 'files missing' };
    if (value.length > LIMITS.files)
        return { reason: `more than ${LIMITS.files} files` };
    const files = [];
    for (const item of value) {
        const raw = record(item);
        if (!raw || typeof raw.path !== 'string' || typeof raw.content !== 'string')
            return { reason: 'malformed file' };
        const unsafe = unsafeSkillPath(raw.path);
        if (unsafe)
            return { reason: `file path ${JSON.stringify(raw.path)} leaves the skill folder: ${unsafe}` };
        if (bytes(raw.content) > LIMITS.fileBytes)
            return { reason: `${raw.path} larger than ${LIMITS.fileBytes} bytes` };
        files.push({ path: raw.path, content: raw.content });
    }
    return { ok: files };
}
function filesProblem(files) {
    const paths = files.map((file) => file.path.toLowerCase());
    if (new Set(paths).size !== paths.length)
        return 'two files with the same path';
    if (paths.some((rel) => paths.some((other) => other.startsWith(`${rel}/`))))
        return 'a file path is also a folder';
    if (!paths.includes('skill.md'))
        return 'no SKILL.md';
    const total = files.reduce((sum, file) => sum + bytes(file.content), 0);
    return total > LIMITS.skillBytes ? `files larger than ${LIMITS.skillBytes} bytes together` : undefined;
}
/** A `get_skill` answer for `id`, checked: shape, paths, size and checksum. */
export function vetSkill(answer, id) {
    const raw = record(answer);
    if (!raw)
        return { reason: 'answer is not an object' };
    if (raw.id !== id)
        return { reason: `answer is for another id (${String(raw.id)})` };
    const version = str(raw.version);
    const checksum = str(raw.checksum);
    if (!version || !checksum)
        return { reason: 'version or checksum missing' };
    if (version.length > 64 || !/^[\w.+-]+$/.test(version))
        return { reason: 'version is not a plain version string' };
    const files = vetFiles(raw.files);
    if (!('ok' in files))
        return files;
    const problem = filesProblem(files.ok);
    if (problem)
        return { reason: problem };
    const actual = skillChecksum(files.ok);
    if (actual !== checksum)
        return { reason: `checksum mismatch: the files hash to ${actual}` };
    return { ok: { id, version, checksum, title: str(raw.title) ?? id, files: files.ok } };
}
