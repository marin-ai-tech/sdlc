import type { ApprovalGateId, SdlcConfig } from '../core/config.js';
import { approvalChecks } from '../mcp/release-checks.js';

/** Kept after the ordinary approval artifact checks, before any approval persistence. */
export async function gateReleaseChecks(config: SdlcConfig, root: string, change: string, gate: ApprovalGateId) {
  return gate === 'release' ? approvalChecks(config, root, change) : undefined;
}
