import { SdlcError } from './errors.js';
function invalid() {
    throw new SdlcError('invalid_config', { key: 'error.board_market_invalid_config' });
}
export function parseMarket(value) {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid();
    const board = value;
    if (Object.keys(board).some((key) => key !== 'market'))
        invalid();
    if (!board.market || typeof board.market !== 'object' || Array.isArray(board.market))
        invalid();
    const market = board.market;
    if (Object.keys(market).some((key) => !['rule', 'window_seconds'].includes(key)))
        invalid();
    const rule = market.rule ?? 'fastest';
    const seconds = market.window_seconds ?? 300;
    if (!['fastest', 'cheapest', 'first'].includes(rule))
        invalid();
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400)
        invalid();
    return { rule: rule, windowSeconds: seconds };
}
