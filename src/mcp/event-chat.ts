import { readRolesFile } from '../core/roles.js';
import type { EventReceiver } from './event-config.js';
import { eventMessage, peopleNames } from './event-message.js';
import type { EventBody } from './outbox.js';

/**
 * Chat handles of an event (B98): a person in roles.yaml may list `chat: { <channel>: <handle> }`, and a receiver
 * with `chat: <channel>` gets the handles on that channel of the people the event waits for (`waitingForChat`),
 * with its ready text mentioning them. Handles are personal data: the queue keeps them per channel, only for the
 * channels a receiver of the event names, and delivery hands each receiver only its own channel's part; a receiver
 * without `chat` gets the event and the text exactly as before, without any handle (src/mcp/events.ts).
 */
export interface ChatPart {
  /** The handles on the channel of the people in `waitingFor`, in that order; people without one are skipped. */
  handles: string[];
  /** The ready text mentioning them, for receivers of the channel with `message`. */
  message?: string;
}

/** Channel to its part. */
export type ChatParts = Record<string, ChatPart>;

/** Person id to that person's chat handles (channel to handle); empty without roles.yaml or when unreadable. */
export function peopleChats(root: string): Map<string, Record<string, string>> {
  try {
    const people = readRolesFile(root)?.people ?? [];
    return new Map(people.map((person) => [person.id, person.chat ?? {}]));
  } catch {
    return new Map();
  }
}

/** Person id to the handle on the channel, for the people the event waits for who have one. */
function mentionsOn(event: EventBody, channel: string, chats: Map<string, Record<string, string>>):
  Map<string, string> {
  const mentions = new Map<string, string>();
  for (const id of event.waitingFor ?? []) {
    const handle = chats.get(id)?.[channel];
    if (handle) mentions.set(id, handle);
  }
  return mentions;
}

/** The channels the receivers name, each once, in their order. */
function channelsOf(receivers: EventReceiver[]): string[] {
  const channels = receivers.flatMap((receiver) => (receiver.chat ? [receiver.chat] : []));
  return [...new Set(channels)];
}

function wantsText(receivers: EventReceiver[], channel: string): boolean {
  return receivers.some((receiver) => receiver.chat === channel && receiver.message !== undefined);
}

/**
 * The chat parts of an event that waits for people, for the channels its receivers name; nothing for any other
 * event or when no receiver names a channel. The text is built with the names and handles roles.yaml has now.
 */
export function chatParts(root: string, receivers: EventReceiver[], event: EventBody): { chat?: ChatParts } {
  const channels = channelsOf(receivers);
  if (channels.length === 0 || !Array.isArray(event.waitingFor)) return {};
  const chats = peopleChats(root);
  const names = peopleNames(root);
  const chat: ChatParts = {};
  for (const channel of channels) {
    const mentions = mentionsOn(event, channel, chats);
    const text = wantsText(receivers, channel) ? { message: eventMessage(event, names, undefined, mentions) } : {};
    chat[channel] = { handles: [...mentions.values()], ...text };
  }
  return { chat };
}