import * as fs from 'node:fs';
import { agentEnvironment } from '../core/agent-env.js';
import { loadConfig } from '../core/config.js';
import { assertDecisionRole } from '../core/decision-role.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { canonical, fail, keys, object, text } from './api.js';
import { atomicStored, readStored, withActivation } from './activation.js';
import { pluginName } from './manifest.js';
import { capturePackage, hash } from './package.js';
import { invoke } from './runtime.js';
import { genesis, readStore } from './store.js';
export function assertPluginHuman(root) {
    if (agentEnvironment() || process.env.SDLC_MCP_ORIGIN === '1') {
        fail('agent_cannot_approve', 'Plugin trust and recovery require a person in their own terminal');
    }
    assertDecisionRole(root, 'team accept');
    const by = formatIdentity(gitIdentity(root));
    if (!by)
        fail('no_identity', 'A git identity is required for plugin acceptance');
    return by;
}
export function readRegistry(root) {
    const raw = readStored(root, 'registry.json');
    if (raw === undefined)
        return { version: 1, plugins: Object.create(null) };
    const v = object(raw, 'plugin registry');
    keys(v, ['version', 'plugins'], 'registry');
    if (v.version !== 1)
        fail('plugin_store', 'Unknown plugin registry version');
    const plugins = Object.create(null);
    for (const [name, item] of Object.entries(object(v.plugins, 'registry plugins'))) {
        pluginName(name);
        const a = object(item, 'acceptance');
        keys(a, ['name', 'source', 'version', 'digest', 'stateId', 'status', 'by', 'at'], 'acceptance');
        if (a.name !== name || typeof a.status !== 'string' || !['accepted', 'revoked'].includes(a.status)
            || typeof a.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(a.digest))
            fail('plugin_store', 'Invalid acceptance');
        plugins[name] = { name, source: text(a.source, 'source'), version: text(a.version, 'version'),
            digest: a.digest, stateId: text(a.stateId, 'stateId'), status: a.status,
            by: text(a.by, 'by'), at: text(a.at, 'at') };
        if (!Number.isFinite(Date.parse(plugins[name].at)))
            fail('plugin_store', 'Invalid acceptance timestamp');
    }
    return { version: 1, plugins };
}
export function configured(root, config, name) {
    pluginName(name);
    const setting = config.plugins?.[name];
    if (!setting)
        fail('plugin_unknown', 'Plugin is not configured');
    const snapshot = capturePackage(root, setting.package);
    if (snapshot.manifest.name !== name)
        fail('plugin_name', 'Configured and manifest namespaces differ');
    if (snapshot.digest !== setting.digest)
        fail('plugin_changed', 'Package contents do not match the configured pin');
    return { snapshot, setting };
}
export function activePlugin(root, config, name) {
    const { snapshot, setting } = configured(root, config, name);
    if (!setting.enabled)
        fail('plugin_disabled', 'Plugin is disabled');
    const accepted = readRegistry(root).plugins[name];
    if (!accepted || accepted.status !== 'accepted')
        fail('plugin_unaccepted', 'Plugin needs human acceptance');
    if (accepted.digest !== snapshot.digest || accepted.source !== setting.package
        || accepted.version !== snapshot.manifest.version)
        fail('plugin_changed', 'Plugin acceptance is stale');
    const store = readStore(root, name, accepted.stateId);
    const configDigest = hash(fs.readFileSync(`${root}/openspec/sdlc.yaml`));
    return { snapshot, setting, accepted, store,
        configDigest, key: hash(canonical({ setting, accepted, revision: store.revision, configDigest })) };
}
export function currentActive(root, previous) {
    const config = loadConfig(`${root}/openspec/sdlc.yaml`);
    const current = activePlugin(root, config, previous.snapshot.manifest.name);
    if (previous.key !== current.key)
        fail('plugin_evaluation_stale', 'Plugin trust/configuration/state changed');
    return current;
}
export async function acceptPlugin(root, config, name, expected) {
    const by = assertPluginHuman(root);
    const { snapshot, setting } = configured(root, config, name);
    if (expected !== snapshot.digest)
        fail('plugin_changed', 'Expected digest differs; no acceptance recorded');
    await invoke(snapshot, { preflight: true, validate: { kind: 'config', value: setting.config } });
    const old = readRegistry(root).plugins[name];
    const oldState = readStore(root, name, old?.stateId);
    if (!old && oldState && (oldState.revision !== 0 || oldState.pending.length || oldState.receipts.length
        || oldState.genesis.digest !== snapshot.digest || oldState.genesis.source !== setting.package
        || oldState.genesis.stateDigest !== hash(canonical(snapshot.manifest.initialState))
        || canonical(oldState.data) !== canonical(snapshot.manifest.initialState))) {
        fail('plugin_store', 'An orphan genesis may be reused only with its exact package and untouched initial state');
    }
    if (oldState) {
        await invoke(snapshot, { preflight: true, validate: { kind: 'state', value: oldState.data } });
    }
    return withActivation(root, () => {
        const fresh = configured(root, loadConfig(`${root}/openspec/sdlc.yaml`), name);
        if (fresh.snapshot.digest !== snapshot.digest || canonical(fresh.setting) !== canonical(setting)) {
            fail('plugin_changed', 'Plugin changed during acceptance');
        }
        const registry = readRegistry(root);
        if (canonical(registry.plugins[name] ?? null) !== canonical(old ?? null))
            fail('plugin_evaluation_stale', 'Trust changed');
        const state = readStore(root, name, old?.stateId);
        if (state?.stateId !== oldState?.stateId || state?.revision !== oldState?.revision) {
            fail('plugin_evaluation_stale', 'State changed during acceptance');
        }
        const store = genesis(root, name, snapshot.manifest.initialState, { source: setting.package, digest: snapshot.digest }, old?.stateId);
        const accepted = { name, source: setting.package, digest: snapshot.digest,
            version: snapshot.manifest.version, stateId: store.stateId, status: 'accepted', by, at: new Date().toISOString() };
        registry.plugins[name] = accepted;
        atomicStored(root, 'registry.json', registry);
        return accepted;
    });
}
export function revokePlugin(root, name) {
    const by = assertPluginHuman(root);
    return withActivation(root, () => {
        const registry = readRegistry(root);
        const previous = registry.plugins[pluginName(name)];
        if (!previous)
            fail('plugin_unknown', 'Plugin has no acceptance to revoke');
        const revoked = { ...previous, status: 'revoked', by, at: new Date().toISOString() };
        registry.plugins[name] = revoked;
        atomicStored(root, 'registry.json', registry);
        return revoked;
    });
}
