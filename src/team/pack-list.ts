import type { SdlcConfig } from '../core/config.js';
import type { PackConfig } from './pack-config.js';
import type { PackProblem } from './pack-contents.js';
import { contentsReport, fetchedCopy } from './pack-effect.js';

/**
 * The packs of sdlc.yaml as `sdlc team list` shows them (0.20.1): whether a pack is synced (a copy was fetched for its
 * current entry), whether its lenses, workflows and checks are in effect (a person accepted this very content), what
 * it brings and why it cannot be accepted. Read-only: it fetches nothing and accepts nothing.
 */
export interface PackListItem {
  name: string;
  source: string;
  synced: boolean;
  inEffect: boolean;
  lenses: string[];
  workflows: string[];
  checks: string[];
  problems: PackProblem[];
}

function sourceOf(pack: PackConfig): string {
  return 'git' in pack ? `git ${pack.git} ${pack.ref}` : `npm ${pack.npm}`;
}

function item(root: string, pack: PackConfig): PackListItem {
  const base = { name: pack.name, source: sourceOf(pack), lenses: [], workflows: [], checks: [], problems: [] };
  const fetched = fetchedCopy(root, pack);
  if (!fetched) return { ...base, synced: false, inEffect: false };
  const report = contentsReport(root, pack, fetched);
  if (!report) return { ...base, synced: true, inEffect: false };
  const { lenses, workflows, checks, problems, accepted } = report;
  return { ...base, synced: true, inEffect: accepted, lenses, workflows, checks, problems };
}

/** Every pack of the config, in its order. */
export function listPacks(root: string, config: SdlcConfig): PackListItem[] {
  return (config.packs ?? []).map((pack) => item(root, pack));
}
