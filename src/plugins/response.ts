import { LIMITS, fail, json, keys, object, type Manifest, type PluginResponse } from './api.js';

function eventEnvelope(value: unknown, manifest: Manifest): void {
  const event = object(value, 'event');
  keys(event, ['name', 'data'], 'event');
  if (typeof event.name !== 'string' || !Object.hasOwn(manifest.events, event.name)) {
    fail('plugin_event', 'Undeclared event');
  }
  if (!Object.hasOwn(event, 'data')) fail('plugin_invalid', 'Event must declare data');
  json(event.data, LIMITS.eventBytes);
}

/** Fixed host contract only. Plugin schemas remain inside the bounded worker. */
export function responseEnvelope(value: unknown, manifest: Manifest, operation: string, hook = false): PluginResponse {
  const bounded = json(value);
  const result = object(bounded, 'response');
  keys(result, ['output', 'facts', 'state', 'events'], 'response');
  if (!Object.hasOwn(result, 'output')) fail('plugin_invalid', 'Response must declare output');
  if (!Object.hasOwn(manifest.operations, operation)) fail('plugin_operation', 'Unknown plugin operation');
  if (result.facts !== undefined) object(result.facts, 'facts');
  const events = result.events === undefined ? [] : result.events;
  if (!Array.isArray(events) || events.length > LIMITS.effects) fail('plugin_limit', 'Invalid event batch');
  for (const event of events) eventEnvelope(event, manifest);
  if ((hook || manifest.operations[operation].access === 'read')
    && (result.state !== undefined || events.length)) {
    fail('plugin_effect', 'Read and hook operations cannot persist effects');
  }
  return bounded as unknown as PluginResponse;
}
