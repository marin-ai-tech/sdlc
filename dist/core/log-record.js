import { recordObject, stringFields, stringList } from './record-values.js';
function validSummary(value) {
    const raw = recordObject(value);
    if (!raw || !['done', 'active', 'awaitingHuman', 'blocked'].every((key) => typeof raw[key] === 'number' && Number.isFinite(raw[key])))
        return false;
    if (!stringList(raw.activeIds) || !Array.isArray(raw.waiting))
        return false;
    return raw.waiting.every((entry) => {
        const item = recordObject(entry);
        return item && stringFields(item, ['id', 'gate']) && stringList(item.waitingFor);
    });
}
/** Parse before log filtering, rendering or digest/identity use. Unknown fields are not interpreted. */
export function parseLogEntry(value) {
    const raw = recordObject(value);
    if (!raw)
        return undefined;
    const sdlc = raw.sdlc === undefined ? raw.scdl : raw.sdlc;
    const entry = { ...raw, sdlc };
    if (!stringFields(entry, ['ts', 'event', 'sdlc', 'license'], ['change', 'by', 'detail', 'digest', 'agent', 'task', 'executor']))
        return undefined;
    if (raw.waitingFor !== undefined && !stringList(raw.waitingFor))
        return undefined;
    if (raw.summary !== undefined && !validSummary(raw.summary))
        return undefined;
    if (raw.plugin !== undefined) {
        const plugin = recordObject(raw.plugin);
        if (!plugin || !stringFields(plugin, ['name', 'version', 'digest', 'eventId', 'request', 'transaction'])
            || !/^[a-z][a-z0-9-]{0,23}$/.test(plugin.name)
            || !raw.event.startsWith(`${plugin.name}.`) || !/^sha256:[a-f0-9]{64}$/.test(plugin.digest)
            || plugin.payload === undefined)
            return undefined;
    }
    delete entry.scdl;
    return entry;
}
