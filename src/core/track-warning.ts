import type { ChangeRef } from './changes.js';
import type { ChangeState } from './change-state.js';

export function trackWarning(ref: ChangeRef, state: ChangeState, cli: string): string | undefined {
  const suggestion = state.track_suggestion;
  if (!suggestion || ref.archived) return undefined;
  const command = `${cli} track set ${suggestion.track} --change ${ref.id}`;
  return `Track ${suggestion.track} suggested; confirm with \`${command}\`.`;
}
