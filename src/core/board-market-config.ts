import { SdlcError } from './errors.js';

export interface MarketConfig {
  rule: 'fastest' | 'cheapest' | 'first';
  windowSeconds: number;
}

function invalid(): never {
  throw new SdlcError('invalid_config', { key: 'error.board_market_invalid_config' });
}

export function parseMarket(value: unknown): MarketConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const board = value as Record<string, unknown>;
  if (Object.keys(board).some((key) => key !== 'market')) invalid();
  if (!board.market || typeof board.market !== 'object' || Array.isArray(board.market)) invalid();
  const market = board.market as Record<string, unknown>;
  if (Object.keys(market).some((key) => !['rule', 'window_seconds'].includes(key))) invalid();
  const rule = market.rule ?? 'fastest';
  const seconds = market.window_seconds ?? 300;
  if (!['fastest', 'cheapest', 'first'].includes(rule as string)) invalid();
  if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 86_400) invalid();
  return { rule: rule as MarketConfig['rule'], windowSeconds: seconds as number };
}
