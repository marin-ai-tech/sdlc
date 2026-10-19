import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, type SdlcConfig } from '../core/config.js';
import { findProjectRoot, projectPaths } from '../core/project.js';
import { withServer } from './client.js';
import { chatParts, type ChatPart } from './event-chat.js';
import { resolveEventArgs } from './event-args.js';
import { receiverKey, type EventReceiver } from './event-config.js';
import { eventMessage, peopleNames, withNote } from './event-message.js';
import {
  readOutbox, settleCalls, settleQueued, type EventBody, type QueuedCall, type QueuedFile,
} from './outbox.js';
import type { McpServer } from './registry.js';
import { dropStaleWaits } from './stale-waits.js';

/**
 * Delivery of queued events (B45) with the MCP client: each receiver's tool is called with `{ ...args, event }`,
 * or, for a receiver with `message`, with `{ ...args, [message]: text }` and no `event` (the text of the queue).
 * The note of a rejection or a rework goes only to a receiver with `include_note: true` (0.16.1): as `event.note`,
 * or after the text (`<text> — <note>`); every other receiver gets exactly the event or the text, without it.
 * Chat handles go only to a receiver with `chat: <channel>` (B98): its event gets `waitingForChat` and its text is
 * the one that mentions the people on that channel; a receiver without `chat` never gets a handle.
 * After a CLI command (not inside `sdlc hook`, not inside `sdlc mcp serve`) the whole delivery has 5 s; `sdlc events
 * flush` has no total limit and 10 s per call. A delivered event leaves the queue, anything else waits for the next
 * command. A failure is never an error and never changes the exit code; with SDLC_DEBUG set it is named on stderr.
 */
export const AFTER_COMMAND_MS = 5_000;
export const FLUSH_CALL_MS = 10_000;

export interface DeliveryResult {
  delivered: number;
  failed: number;
}

export interface DeliveryLimits {
  /** The time for the whole delivery; undefined = no total limit. */
  totalMs?: number;
  /** The time for one tool call (and for connecting). */
  callMs: number;
}

type EventsConfig = Pick<SdlcConfig, 'events' | 'mcp' | 'issues'>;

/** One event for one receiver. */
interface Delivery {
  queued: QueuedFile;
  receiver: EventReceiver;
  delivered: boolean;
}

/** One queued tool call (B93): it carries its own arguments, no receiver resolves them. */
interface CallWork {
  queued: QueuedFile;
  call: QueuedCall;
  delivered: boolean;
}

function debug(text: string): void {
  if (process.env.SDLC_DEBUG) process.stderr.write(`sdlc: ${text}\n`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Drops receivers a queued event names that sdlc.yaml no longer has, so the event does not wait forever. */
function dropRemoved(queued: QueuedFile[], receivers: EventReceiver[]): void {
  const known = new Set(receivers.map(receiverKey));
  for (const item of queued) {
    const removed = item.item.receivers.filter((key) => !known.has(key));
    if (removed.length > 0) settleQueued(item, removed);
  }
}

/** The deliveries one server owes: each queued event for each of its receivers that still waits for it. */
function deliveriesFor(server: string, queued: QueuedFile[], receivers: EventReceiver[]): Delivery[] {
  const own = receivers.filter((receiver) => receiver.server === server);
  return queued.flatMap((item) => own
    .filter((receiver) => item.item.receivers.includes(receiverKey(receiver)))
    .map((receiver) => ({ queued: item, receiver, delivered: false })));
}

/** The well-formed calls of a queued item; a malformed one is skipped (untrusted queue content). */
function callsOf(item: QueuedFile): QueuedCall[] {
  return (item.item.calls ?? []).filter((call) =>
    !!call && typeof call.server === 'string' && typeof call.tool === 'string'
    && call.args !== null && typeof call.args === 'object' && !Array.isArray(call.args));
}

/** The calls one server owes: each queued call that names it and has not gone through yet. */
function callsFor(server: string, queued: QueuedFile[]): CallWork[] {
  return queued.flatMap((item) => callsOf(item)
    .filter((call) => call.server === server)
    .map((call) => ({ queued: item, call, delivered: false })));
}

/** Drops queued calls whose server sdlc.yaml no longer has, so they do not wait forever. */
function dropRemovedCalls(queued: QueuedFile[], config: EventsConfig): void {
  const known = new Set((config.mcp?.servers ?? []).map((server) => server.name));
  for (const item of queued) {
    const removed = callsOf(item).filter((call) => !known.has(call.server));
    if (removed.length > 0) settleCalls(item, removed);
  }
}

/**
 * Events queued without a text (before a receiver asked for one) get it now, in the locale of this command;
 * kept in memory only, the queued file stays as it is until the event is delivered.
 */
function fillMessages(root: string, queued: QueuedFile[], receivers: EventReceiver[]): void {
  const wanting = new Set(receivers.filter((receiver) => receiver.message).map(receiverKey));
  const missing = queued.filter((item) => item.item.message === undefined
    && item.item.receivers.some((key) => wanting.has(key)));
  if (missing.length === 0) return;
  const names = peopleNames(root);
  for (const item of missing) item.item.message = eventMessage(item.item.event, names);
}

/**
 * Events queued without chat parts (by an older sdlc, or before a receiver named a channel) get them now from
 * roles.yaml, for the receivers with `chat` that still wait for them; kept in memory, as the texts above.
 */
function fillChats(root: string, queued: QueuedFile[], receivers: EventReceiver[]): void {
  for (const item of queued) {
    if (item.item.chat !== undefined) continue;
    const waiting = (receiver: EventReceiver) => item.item.receivers.includes(receiverKey(receiver));
    const chatting = receivers.filter((receiver) => receiver.chat !== undefined && waiting(receiver));
    if (chatting.length > 0) Object.assign(item.item, chatParts(root, chatting, item.item.event));
  }
}

/** The queued chat part of the receiver's channel; undefined for a receiver without `chat`. */
function chatOf(delivery: Delivery): ChatPart | undefined {
  const channel = delivery.receiver.chat;
  return channel ? delivery.queued.item.chat?.[channel] : undefined;
}

/** The queued note for a receiver that opted in to it; undefined for every other receiver. */
function noteOf(delivery: Delivery): string | undefined {
  return delivery.receiver.includeNote === true ? delivery.queued.item.note : undefined;
}

type DeliveredEvent = EventBody & { note?: string; waitingForChat?: string[] };

/**
 * The event a receiver gets: with `note` only when the receiver opted in and the queue has one, with
 * `waitingForChat` only for a receiver with `chat` and an event that waits for people.
 */
function eventFor(event: EventBody, note: string | undefined, chat: ChatPart | undefined): DeliveredEvent {
  const handles = chat ? { waitingForChat: [...chat.handles] } : {};
  return { ...event, ...(note ? { note } : {}), ...handles };
}

/**
 * The tool's arguments: the static args and the event, or the static args and the text in the named argument;
 * the note is added only for a receiver with `include_note`, the chat handles only for a receiver with `chat`.
 */
function toolArguments(delivery: Delivery, staticArgs: Record<string, unknown>): Record<string, unknown> {
  const { receiver, queued } = delivery;
  const note = noteOf(delivery);
  const chat = chatOf(delivery);
  if (!receiver.message) return { ...staticArgs, event: eventFor(queued.item.event, note, chat) };
  const text = chat?.message ?? queued.item.message ?? '';
  return { ...staticArgs, [receiver.message]: withNote(text, note) };
}

async function deliverCallOne(client: Client, work: CallWork, ms: number): Promise<void> {
  const call = work.call;
  try {
    const answer = await client.callTool({ name: call.tool, arguments: call.args }, undefined, { timeout: ms });
    if ((answer as { isError?: unknown }).isError === true) {
      debug(`${call.server}/${call.tool} answered with an error; the call waits`);
      return;
    }
    work.delivered = true;
    settleCalls(work.queued, [call]);
  } catch (error) {
    debug(`${call.server}/${call.tool}: ${errorText(error)}; the call waits`);
  }
}

async function deliverOne(client: Client, delivery: Delivery, ms: number): Promise<void> {
  const resolved = resolveEventArgs(delivery.receiver.args, process.env);
  if (resolved.missing.length > 0) {
    debug(`${receiverKey(delivery.receiver)} waits for ${resolved.missing.join(', ')}`);
    return;
  }
  const args = toolArguments(delivery, resolved.args ?? {});
  const tool = delivery.receiver.tool;
  try {
    const answer = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: ms });
    if ((answer as { isError?: unknown }).isError === true) {
      debug(`${receiverKey(delivery.receiver)} answered with an error; the event waits`);
      return;
    }
    delivery.delivered = true;
    settleQueued(delivery.queued, [receiverKey(delivery.receiver)]);
  } catch (error) {
    debug(`${receiverKey(delivery.receiver)}: ${errorText(error)}; the event waits`);
  }
}

/** The time left for the next step: the call limit, or less when the total runs out. */
function timeLeft(limits: DeliveryLimits, deadline: number | undefined): number {
  if (deadline === undefined) return limits.callMs;
  return Math.min(limits.callMs, deadline - Date.now());
}

async function deliverToServer(server: McpServer, deliveries: Delivery[], calls: CallWork[],
  limits: DeliveryLimits, deadline: number | undefined): Promise<void> {
  const sessionMs = deadline === undefined
    ? limits.callMs * (deliveries.length + calls.length + 1)
    : deadline - Date.now();
  try {
    await withServer(server, sessionMs, async (client) => {
      for (const delivery of deliveries) {
        const ms = timeLeft(limits, deadline);
        if (ms <= 0) return;
        await deliverOne(client, delivery, ms);
      }
      for (const work of calls) {
        const ms = timeLeft(limits, deadline);
        if (ms <= 0) return;
        await deliverCallOne(client, work, ms);
      }
    });
  } catch (error) {
    debug(`the server ${server.name} could not be reached: ${errorText(error)}; its events wait`);
  }
}

/** The registry servers the queue owes work: the receiver servers and the queued calls' servers. */
function serversOf(config: EventsConfig, receivers: EventReceiver[], queued: QueuedFile[]): McpServer[] {
  const names = new Set(receivers.map((receiver) => receiver.server));
  for (const item of queued) {
    for (const call of callsOf(item)) names.add(call.server);
  }
  return (config.mcp?.servers ?? []).filter((server) => names.has(server.name));
}

/** Sends the queued events to their receivers and the queued calls to their servers within `limits`. */
export async function deliverPending(root: string, config: EventsConfig, limits: DeliveryLimits):
  Promise<DeliveryResult> {
  const receivers = config.events ?? [];
  const sinks = receivers.length > 0 || config.issues !== undefined;
  const queued = sinks ? dropStaleWaits(root, config as SdlcConfig, readOutbox(root)) : [];
  if (queued.length === 0) return { delivered: 0, failed: 0 };
  dropRemoved(queued, receivers);
  dropRemovedCalls(queued, config);
  fillMessages(root, queued, receivers);
  fillChats(root, queued, receivers);
  const deadline = limits.totalMs === undefined ? undefined : Date.now() + limits.totalMs;
  const all: Delivery[] = [];
  const callWork: CallWork[] = [];
  for (const server of serversOf(config, receivers, queued)) {
    const deliveries = deliveriesFor(server.name, queued, receivers);
    const calls = callsFor(server.name, queued);
    all.push(...deliveries);
    callWork.push(...calls);
    const work = deliveries.length + calls.length;
    if (work === 0 || timeLeft(limits, deadline) <= 0) continue;
    await deliverToServer(server, deliveries, calls, limits, deadline);
  }
  const delivered = all.filter((delivery) => delivery.delivered).length
    + callWork.filter((work) => work.delivered).length;
  return { delivered, failed: all.length + callWork.length - delivered };
}

/**
 * The delivery after a CLI command: a project without `events` returns before anything is read from git or a
 * server is started. Never throws and never touches the exit code.
 */
export async function deliverAfterCommand(cwd: string = process.cwd()): Promise<void> {
  try {
    const root = findProjectRoot(cwd);
    if (!root) return;
    const config = loadConfig(projectPaths(root).sdlcConfig);
    if (!config.events?.length && !config.issues) return;
    const limits = { totalMs: AFTER_COMMAND_MS, callMs: AFTER_COMMAND_MS };
    const result = await deliverPending(root, config, limits);
    if (result.failed > 0) debug(`${result.failed} event(s) not delivered; they wait in the outbox`);
  } catch (error) {
    debug(`event delivery failed: ${errorText(error)}`);
  }
}
