import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, type SdlcConfig } from '../core/config.js';
import { findProjectRoot, projectPaths } from '../core/project.js';
import { withServer } from './client.js';
import { receiverKey, type EventReceiver } from './event-config.js';
import { readOutbox, settleQueued, type QueuedFile } from './outbox.js';
import type { McpServer } from './registry.js';

/**
 * Delivery of queued events (B45) with the MCP client: each receiver's tool is called with `{ ...args, event }`.
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

type EventsConfig = Pick<SdlcConfig, 'events' | 'mcp'>;

/** One event for one receiver. */
interface Delivery {
  queued: QueuedFile;
  receiver: EventReceiver;
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

async function deliverOne(client: Client, delivery: Delivery, ms: number): Promise<void> {
  const args = { ...delivery.receiver.args, event: delivery.queued.item.event };
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

async function deliverToServer(server: McpServer, deliveries: Delivery[], limits: DeliveryLimits,
  deadline: number | undefined): Promise<void> {
  const sessionMs = deadline === undefined ? limits.callMs * (deliveries.length + 1) : deadline - Date.now();
  try {
    await withServer(server, sessionMs, async (client) => {
      for (const delivery of deliveries) {
        const ms = timeLeft(limits, deadline);
        if (ms <= 0) return;
        await deliverOne(client, delivery, ms);
      }
    });
  } catch (error) {
    debug(`the server ${server.name} could not be reached: ${errorText(error)}; its events wait`);
  }
}

function serversOf(config: EventsConfig, receivers: EventReceiver[]): McpServer[] {
  const names = new Set(receivers.map((receiver) => receiver.server));
  return (config.mcp?.servers ?? []).filter((server) => names.has(server.name));
}

/** Sends the queued events to their receivers within `limits`; counts each event-receiver pair once. */
export async function deliverPending(root: string, config: EventsConfig, limits: DeliveryLimits):
  Promise<DeliveryResult> {
  const receivers = config.events ?? [];
  const queued = receivers.length > 0 ? readOutbox(root) : [];
  if (queued.length === 0) return { delivered: 0, failed: 0 };
  dropRemoved(queued, receivers);
  const deadline = limits.totalMs === undefined ? undefined : Date.now() + limits.totalMs;
  const all: Delivery[] = [];
  for (const server of serversOf(config, receivers)) {
    const deliveries = deliveriesFor(server.name, queued, receivers);
    all.push(...deliveries);
    if (deliveries.length === 0 || timeLeft(limits, deadline) <= 0) continue;
    await deliverToServer(server, deliveries, limits, deadline);
  }
  const delivered = all.filter((delivery) => delivery.delivered).length;
  return { delivered, failed: all.length - delivered };
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
    if (!config.events?.length) return;
    const limits = { totalMs: AFTER_COMMAND_MS, callMs: AFTER_COMMAND_MS };
    const result = await deliverPending(root, config, limits);
    if (result.failed > 0) debug(`${result.failed} event(s) not delivered; they wait in the outbox`);
  } catch (error) {
    debug(`event delivery failed: ${errorText(error)}`);
  }
}
