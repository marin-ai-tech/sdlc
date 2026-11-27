import { approvalChecks } from '../mcp/release-checks.js';
/** Kept after the ordinary approval artifact checks, before any approval persistence. */
export async function gateReleaseChecks(config, root, change, gate) {
    return gate === 'release' ? approvalChecks(config, root, change) : undefined;
}
