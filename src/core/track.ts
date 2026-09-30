/**
 * Track selection. The CLI suggests a track from the change's kind and risk;
 * a `lite` track skips the intent and spec gates, so choosing it is a human
 * decision: an agent (or the CLI itself) can only suggest it, and a person
 * confirms with `sdlc track set lite --change <id>`. `full` is always safe
 * and is applied without confirmation.
 */
import type { ChangeKind, RiskLevel, Track } from './change-state.js';

export interface TrackSuggestion {
  track: Track;
  /** Short, human-readable reasons, e.g. "bugfix with low risk". */
  reasons: string[];
}

/**
 * `lite` only for kind bugfix | refactor | chore | docs with risk low.
 * Everything else is `full`; security and incident changes and risk high are
 * always `full`, whatever else is true.
 */
export function suggestTrack(kind: ChangeKind, risk: RiskLevel): TrackSuggestion {
  if (risk === 'high') return { track: 'full', reasons: ['high risk requires the full track'] };
  if (kind === 'security' || kind === 'incident') return { track: 'full', reasons: [`${kind} changes require the full track`] };
  if (risk === 'low' && (kind === 'bugfix' || kind === 'refactor' || kind === 'chore' || kind === 'docs')) {
    return { track: 'lite', reasons: [`${kind} with low risk`] };
  }
  return { track: 'full', reasons: [`${kind} with ${risk} risk`] };
}
