import { SdlcError } from './errors.js';
export const EPIC_GRANULARITIES = ['package', 'feature', 'small'];
export function isEpicGranularity(value) {
    return EPIC_GRANULARITIES.some((entry) => entry === value);
}
export function parseEpicGranularity(value) {
    if (value === undefined)
        return undefined;
    if (isEpicGranularity(value))
        return value;
    throw new SdlcError('invalid_option', { key: 'error.epic_granularity' });
}
