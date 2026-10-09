import * as path from 'node:path';
import { parseAnswers } from './answer-record.js';
import { isSeq } from './decision-order.js';
import { SdlcError } from './errors.js';
import { isFile } from './fs-utils.js';
import { readYamlObject, writeYaml } from './yaml-io.js';
/**
 * Per-change lifecycle record, stored as `.sdlc.yaml` inside the OpenSpec
 * change folder. OpenSpec ignores unknown files in a change folder and keeps
 * them through `openspec archive`, so the record travels with the change into
 * `changes/archive/` and stays part of the audit trail.
 */
export const CHANGE_KINDS = ['feature', 'bugfix', 'refactor', 'chore', 'docs', 'incident', 'security'];
export const RISK_LEVELS = ['low', 'medium', 'high'];
export const SOURCE_TYPES = ['idea', 'ticket', 'incident', 'alert', 'scan', 'review', 'exploration', 'bmad', 'backlog', 'deferred', 'health', 'other'];
/**
 * `full` runs every gate. `lite` is the fast path for bounded work (a small
 * bug fix, refactor or chore): the intent and spec gates become optional and
 * the change starts at the plan.
 */
export const TRACKS = ['full', 'lite'];
export function provenance(stamp) {
    return stamp ? { sdlc: stamp.version, license: stamp.license } : {};
}
const SUPPORTED_VERSIONS = [1, 2, 3];
export const STATE_FILE = '.sdlc.yaml';
export function statePath(changeDir) {
    return path.join(changeDir, STATE_FILE);
}
export function newChangeState(init = {}) {
    return {
        version: 1,
        kind: init.kind ?? 'feature',
        risk: init.risk ?? 'medium',
        track: init.track ?? 'full',
        created: new Date().toISOString(),
        ...(init.source ? { source: init.source } : {}),
        gates: {},
        history: [],
    };
}
function oneOf(value, allowed, fallback) {
    return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}
/**
 * Reads the record, tolerating a missing file (a plain OpenSpec change that
 * never went through `sdlc new` still gets a lifecycle view with defaults).
 */
/**
 * Records written before the rename from scdl carry the version under `scdl:`; they are read as `sdlc:`
 * (and rewritten with the new key on the next write). No other key in a change record is called `scdl`.
 */
function renameLegacyKeys(value) {
    if (Array.isArray(value))
        return value.map(renameLegacyKeys);
    if (!value || typeof value !== 'object')
        return value;
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
        const name = key === 'scdl' && !('sdlc' in value) ? 'sdlc' : key;
        out[name] = renameLegacyKeys(inner);
    }
    return out;
}
/** A takeover record as read: a malformed one still holds the change (fail closed), with what it carries. */
function takeoverOf(value) {
    if (!value || typeof value !== 'object')
        return {};
    const raw = value;
    const text = (field, fallback) => (typeof field === 'string' ? field : fallback);
    return { takeover: { by: text(raw.by, 'unknown'), at: text(raw.at, ''), note: text(raw.note, '') } };
}
/** The well-formed `answers` entries; absent when there are none. */
function answersOf(value) {
    const answers = parseAnswers(value);
    return answers.length > 0 ? { answers } : {};
}
export function readChangeState(changeDir) {
    const file = statePath(changeDir);
    if (!isFile(file))
        return { ...newChangeState(), created: '' };
    const raw = renameLegacyKeys(readYamlObject(file) ?? {});
    if (raw.version !== undefined && !SUPPORTED_VERSIONS.includes(raw.version)) {
        throw new SdlcError('unsupported_state_version', { key: 'error.x_has_unsupported_version_x', params: { file: file, p2: String(raw.version) } });
    }
    const gates = (raw.gates && typeof raw.gates === 'object' ? raw.gates : {});
    const source = raw.source && typeof raw.source === 'object' ? raw.source : undefined;
    const harness = raw.harness && typeof raw.harness === 'object' ? raw.harness : undefined;
    const suggestion = raw.track_suggestion && typeof raw.track_suggestion === 'object' ? raw.track_suggestion : undefined;
    return {
        version: raw.version === 3 ? 3 : raw.version === 2 ? 2 : 1,
        ...(harness && typeof harness.sdlc === 'string' && typeof harness.license === 'string'
            ? { harness: { sdlc: harness.sdlc, license: harness.license } }
            : {}),
        kind: oneOf(raw.kind, CHANGE_KINDS, 'feature'),
        risk: oneOf(raw.risk, RISK_LEVELS, 'medium'),
        track: oneOf(raw.track, TRACKS, 'full'),
        ...(suggestion && typeof suggestion.track === 'string' && TRACKS.includes(suggestion.track) && Array.isArray(suggestion.reasons) && suggestion.reasons.every((r) => typeof r === 'string')
            ? { track_suggestion: { track: suggestion.track, reasons: suggestion.reasons } } : {}),
        created: typeof raw.created === 'string' ? raw.created : '',
        ...(source
            ? {
                source: {
                    type: oneOf(source.type, SOURCE_TYPES, 'other'),
                    ...(typeof source.ref === 'string' ? { ref: source.ref } : {}),
                    ...(typeof source.url === 'string' ? { url: source.url } : {}),
                },
            }
            : {}),
        ...(raw.links && typeof raw.links === 'object' ? { links: raw.links } : {}),
        ...(raw.tests_locked === true ? { tests_locked: true } : {}),
        ...(raw.kind_by_agent === true ? { kind_by_agent: true } : {}),
        ...takeoverOf(raw.takeover),
        ...answersOf(raw.answers),
        ...(isSeq(raw.seq) ? { seq: raw.seq } : {}),
        gates,
        ...(raw.verify && typeof raw.verify === 'object' ? { verify: raw.verify } : {}),
        history: Array.isArray(raw.history) ? raw.history : [],
    };
}
/** The format a record needs: 3 with answers, 2 with a gate rework or a takeover (fields older CLIs lack), else 1. */
export function stateVersion(state) {
    if ((state.answers ?? []).length > 0)
        return 3;
    const reworked = Object.values(state.gates).some((gate) => gate?.rework !== undefined);
    return reworked || state.takeover !== undefined ? 2 : 1;
}
/** Writes the record; with a stamp, `harness` records the sdlc version and license writing it. */
export function writeChangeState(changeDir, state, stamp) {
    if (stamp)
        state.harness = { sdlc: stamp.version, license: stamp.license };
    state.version = stateVersion(state);
    const ordered = {
        version: state.version,
        ...(state.harness ? { harness: state.harness } : {}),
        kind: state.kind,
        risk: state.risk,
        track: state.track,
        ...(state.track_suggestion ? { track_suggestion: state.track_suggestion } : {}),
        created: state.created || new Date().toISOString(),
        ...(state.source ? { source: state.source } : {}),
        ...(state.links && Object.keys(state.links).length > 0 ? { links: state.links } : {}),
        ...(state.tests_locked ? { tests_locked: true } : {}),
        ...(state.kind_by_agent ? { kind_by_agent: true } : {}),
        ...(state.takeover ? { takeover: state.takeover } : {}),
        ...(state.answers && state.answers.length > 0 ? { answers: state.answers } : {}),
        ...(state.seq !== undefined ? { seq: state.seq } : {}),
        gates: state.gates,
        ...(state.verify ? { verify: state.verify } : {}),
        history: state.history,
    };
    writeYaml(statePath(changeDir), ordered, '# SDLC lifecycle record for this change (managed by `sdlc`; approvals are bound to artifact digests).');
}
export function appendHistory(state, event, by, detail, stamp) {
    state.history.push({
        at: new Date().toISOString(),
        event,
        ...(by ? { by } : {}),
        ...(detail ? { detail } : {}),
        ...provenance(stamp),
    });
}
