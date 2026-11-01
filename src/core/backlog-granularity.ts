import { SdlcError } from './errors.js';

export const EPIC_GRANULARITIES = ['package', 'feature', 'small'] as const;
export type EpicGranularity = (typeof EPIC_GRANULARITIES)[number];

export function isEpicGranularity(value: unknown): value is EpicGranularity {
  return EPIC_GRANULARITIES.some((entry) => entry === value);
}

export function parseEpicGranularity(value: unknown): EpicGranularity | undefined {
  if (value === undefined) return undefined;
  if (isEpicGranularity(value)) return value;
  throw new SdlcError('invalid_option', { key: 'error.epic_granularity' });
}
