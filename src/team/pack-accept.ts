import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import type { ApplyReport } from '../integrations/manifest.js';
import type { PackSource } from './pack-config.js';
import { readPackContents, type PackContents, type PackProblem } from './pack-contents.js';
import { fetchedCopy } from './pack-effect.js';
import { readTeam, TEAM_PATH, writeTeam, type PackEntry } from './record.js';

/**
 * `sdlc team accept --pack <name>` (B18): a person accepts the lenses, workflows and checks of a pack as
 * `team sync` fetched them for its current entry in sdlc.yaml; team.json records their digest and the source, and
 * the generated files follow. The command (src/commands/team.ts) refuses an agent and, with roles.yaml, anyone
 * without the maintainer role first. Refused here: `unknown_pack`, `pack_not_synced` and the pack's first problem
 * (`pack_not_pinned`, `pack_forbidden_command`, `pack_invalid_content`).
 */
export interface PackAcceptResult {
  pack: string;
  source: PackSource;
  digest: string;
  lenses: string[];
  workflows: string[];
  checks: Array<{ name: string; run: string }>;
  team: string;
  files: ApplyReport;
}

function unknownPack(name: string, config: SdlcConfig): SdlcError {
  const list = (config.packs ?? []).map((pack) => pack.name).join(', ') || '-';
  return new SdlcError(
    'unknown_pack',
    { key: 'error.unknown_pack_x', params: { name, list } },
    { key: 'fix.declare_the_pack_under_packs' }
  );
}

function notSynced(name: string): SdlcError {
  return new SdlcError(
    'pack_not_synced',
    { key: 'error.pack_x_not_synced', params: { name } },
    { key: 'fix.run_sdlc_team_sync_then_accept_pack', params: { name } }
  );
}

function refused(name: string, problem: PackProblem): SdlcError {
  const params = { name, item: problem.item, detail: problem.detail };
  return new SdlcError(problem.code, { key: `error.${problem.code}`, params }, { key: `fix.${problem.code}`, params });
}

function entryFor(contents: PackContents, source: PackSource, by: string): PackEntry {
  return {
    digest: contents.digest,
    source,
    lenses: contents.lenses.map((lens) => lens.id),
    workflows: contents.workflows.map((workflow) => workflow.name),
    checks: contents.checks.map((check) => check.name),
    by,
    at: new Date().toISOString(),
  };
}

/** Records the person's acceptance of the pack's current contents and regenerates the files. */
export function acceptPack(root: string, config: SdlcConfig, name: string, by: string): PackAcceptResult {
  const pack = (config.packs ?? []).find((item) => item.name === name);
  if (!pack) throw unknownPack(name, config);
  const fetched = fetchedCopy(root, pack);
  if (!fetched) throw notSynced(name);
  const contents = readPackContents(fetched.dir, pack);
  if (contents.problems.length > 0) throw refused(name, contents.problems[0]);
  const team = readTeam(root);
  const entry = entryFor(contents, fetched.source, by);
  team.packs = { ...(team.packs ?? {}), [name]: entry };
  writeTeam(root, team);
  const files = refreshGeneratedFiles(root, config);
  const checks = contents.checks.map((check) => ({ name: check.name, run: check.run }));
  const { lenses, workflows, digest } = entry;
  return { pack: name, source: fetched.source, digest, lenses, workflows, checks, team: TEAM_PATH, files };
}