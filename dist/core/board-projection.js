import { winner } from './board-market.js';
import { activePlugins } from '../plugins/catalog.js';
/** Read-only projection; elapsed leases do not acquire or write the board. */
export function boardAt(root, config, board, now) {
    let guarded = false;
    try {
        guarded = activePlugins(root, config).some(plugin => !!plugin.snapshot.manifest.hooks.award)
            || !!config.pluginPolicies?.some(policy => policy.hook === 'award');
    }
    catch {
        guarded = Object.values(config.plugins ?? {}).some(setting => setting.enabled);
    }
    const live = (expiresAt) => Date.parse(expiresAt) > now;
    const elapsed = guarded ? [] : board.auctions.filter(auction => !live(auction.closesAt) && auction.bids.length);
    const awarded = elapsed.map(auction => ({
        item: auction.item, change: auction.change, task: auction.task,
        executor: winner(root, auction.bids, config.board?.market.rule ?? 'fastest').executor,
        dispatchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString(), leaseSeconds: 900,
    }));
    return { ...board,
        claims: board.claims.filter(claim => claim.state !== 'held' || live(claim.expiresAt)),
        dispatches: [...board.dispatches.filter(dispatch => live(dispatch.expiresAt)), ...awarded],
        auctions: guarded ? board.auctions : board.auctions.filter(auction => live(auction.closesAt)),
    };
}
