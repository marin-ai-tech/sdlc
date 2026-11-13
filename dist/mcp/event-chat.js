import { readRolesFile } from '../core/roles.js';
import { eventMessage, peopleNames } from './event-message.js';
/** Person id to that person's chat handles (channel to handle); empty without roles.yaml or when unreadable. */
export function peopleChats(root) {
    try {
        const people = readRolesFile(root)?.people ?? [];
        return new Map(people.map((person) => [person.id, person.chat ?? {}]));
    }
    catch {
        return new Map();
    }
}
/** Person id to the handle on the channel, for the people the event waits for who have one. */
function mentionsOn(event, channel, chats) {
    const mentions = new Map();
    for (const id of event.waitingFor ?? []) {
        const handle = chats.get(id)?.[channel];
        if (handle)
            mentions.set(id, handle);
    }
    return mentions;
}
/** The channels the receivers name, each once, in their order. */
function channelsOf(receivers) {
    const channels = receivers.flatMap((receiver) => (receiver.chat ? [receiver.chat] : []));
    return [...new Set(channels)];
}
function wantsText(receivers, channel) {
    return receivers.some((receiver) => receiver.chat === channel && receiver.message !== undefined);
}
/**
 * The chat parts of an event that waits for people, for the channels its receivers name; nothing for any other
 * event or when no receiver names a channel. The text is built with the names and handles roles.yaml has now.
 */
export function chatParts(root, receivers, event) {
    const channels = channelsOf(receivers);
    if (channels.length === 0 || !Array.isArray(event.waitingFor))
        return {};
    const chats = peopleChats(root);
    const names = peopleNames(root);
    const chat = {};
    for (const channel of channels) {
        const mentions = mentionsOn(event, channel, chats);
        const text = wantsText(receivers, channel) ? { message: eventMessage(event, names, undefined, mentions) } : {};
        chat[channel] = { handles: [...mentions.values()], ...text };
    }
    return { chat };
}
