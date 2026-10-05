import type { BacklogItem } from './backlog.js';
import { SdlcError } from './errors.js';

/**
 * A dependency must be work that can still happen: depending on a dropped item would block the
 * dependent item for good, which drops it in effect - and dropping is a person's decision.
 */
export function assertUsableDependency(item: BacklogItem): void {
  if (item.status === 'dropped') {
    throw new SdlcError('dependency_dropped', {
      key: 'error.dependency_dropped',
      params: { id: item.id },
    });
  }
}