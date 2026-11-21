import { SdlcError } from './errors.js';
import { parseExtensions } from '../plugins/api.js';
function invalid(detail) {
    throw new SdlcError('board_invalid', {
        key: 'error.the_board_file_x_is_broken_x',
        params: { file: 'openspec/.sdlc/board.json', detail },
    });
}
export function parseAuctions(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        invalid('auctions must be a list');
    const auctions = value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            invalid('auction must be a mapping');
        const auction = entry;
        for (const key of ['item', 'change', 'task', 'openedAt', 'closesAt']) {
            if (typeof auction[key] !== 'string' || !auction[key])
                invalid(`auctions[].${key} is invalid`);
        }
        if (auction.item !== `${auction.change}#${auction.task}`)
            invalid('auctions[].item is inconsistent');
        if (Number.isNaN(Date.parse(auction.openedAt))
            || Number.isNaN(Date.parse(auction.closesAt)))
            invalid('auction time is invalid');
        if (!Array.isArray(auction.bids))
            invalid('auctions[].bids must be a list');
        const bids = auction.bids.map(parseBid);
        if (new Set(bids.map((bid) => bid.executor)).size !== bids.length)
            invalid('duplicate auction bidder');
        return { ...auction, bids };
    });
    if (new Set(auctions.map((entry) => entry.item)).size !== auctions.length)
        invalid('duplicate auction');
    return auctions;
}
function parseBid(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid('bid must be a mapping');
    const bid = value;
    if (typeof bid.executor !== 'string' || !bid.executor
        || typeof bid.agent !== 'string' || !bid.agent
        || typeof bid.at !== 'string' || Number.isNaN(Date.parse(bid.at)))
        invalid('bid identity or time is invalid');
    if (!Number.isInteger(bid.minutes) || bid.minutes < 1)
        invalid('bid minutes is invalid');
    if (bid.cost !== undefined && (typeof bid.cost !== 'number'
        || !Number.isFinite(bid.cost) || bid.cost < 0))
        invalid('bid cost is invalid');
    const ext = parseExtensions(bid.ext);
    return { ...bid, ...(ext === undefined ? {} : { ext }) };
}
