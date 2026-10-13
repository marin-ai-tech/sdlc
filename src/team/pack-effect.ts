import type { SdlcConfig, VerifyCommand } from '../core/config.js';
import type { PackConfig, PackSource } from './pack-config.js';
import {
  readPackContents, type PackCheck, type PackContents, type PackLens, type PackProblem, type PackWorkflow,
} from './pack-contents.js';
import { cachedPack, type FetchedPack } from './pack-fetch.js';
import { readTeam, type PackEntry } from './record.js';

/**
 * Which lenses, workflows and checks of the packs are in effect (B18): only those of a pack a person accepted with
 * `sdlc team accept --pack`, while the copy fetched for its current entry in sdlc.yaml has the source and the
 * digest team.json recorded and nothing in it is refused. A new version, an edited cache or a changed entry puts
 * none of the pack's contents in effect (the old ones included) until a person accepts again.
 */
export interface AcceptedPack {
  name: string;
  source: PackSource;
  contents: PackContents;
}

/** What `team sync` reports of a pack's lenses, workflows and checks, and whether they are in effect. */
export interface PackContentsReport {
  lenses: string[];
  workflows: string[];
  checks: string[];
  problems: PackProblem[];
  accepted: boolean;
}

const SOURCE_KEYS = ['pack', 'git', 'npm', 'ref', 'commit', 'version', 'integrity'] as const;

/** The copy fetched for this very entry of sdlc.yaml, or undefined (never fetched, entry changed, no git dir). */
export function fetchedCopy(root: string, pack: PackConfig): FetchedPack | undefined {
  try {
    return cachedPack(root, pack);
  } catch {
    return undefined;
  }
}

function sameSource(a: PackSource, b: PackSource): boolean {
  return SOURCE_KEYS.every((key) => a[key] === b[key]);
}

function isInEffect(entry: PackEntry | undefined, fetched: FetchedPack, contents: PackContents): boolean {
  if (!entry || !sameSource(entry.source, fetched.source)) return false;
  return contents.problems.length === 0 && contents.digest === entry.digest;
}

function inEffect(root: string, pack: PackConfig, entry: PackEntry | undefined): AcceptedPack[] {
  if (!entry) return [];
  const fetched = fetchedCopy(root, pack);
  if (!fetched) return [];
  const contents = readPackContents(fetched.dir, pack);
  return isInEffect(entry, fetched, contents) ? [{ name: pack.name, source: fetched.source, contents }] : [];
}

/** The accepted packs whose contents are in effect, in the order of the config. */
export function acceptedPacks(root: string, config: SdlcConfig): AcceptedPack[] {
  const packs = config.packs ?? [];
  if (packs.length === 0) return [];
  const accepted = readTeam(root).packs ?? {};
  return packs.flatMap((pack) => inEffect(root, pack, accepted[pack.name]));
}

/** The items with a key not seen before: the first pack that brings an id wins. */
function firstOf<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function packLenses(root: string, config: SdlcConfig): PackLens[] {
  const lenses = acceptedPacks(root, config).flatMap((pack) => pack.contents.lenses);
  return firstOf(lenses, (lens) => lens.id);
}

export function packWorkflows(root: string, config: SdlcConfig): PackWorkflow[] {
  const workflows = acceptedPacks(root, config).flatMap((pack) => pack.contents.workflows);
  return firstOf(workflows, (workflow) => workflow.name);
}

export function packChecks(root: string, config: SdlcConfig): PackCheck[] {
  return acceptedPacks(root, config).flatMap((pack) => pack.contents.checks);
}

/** The lenses a review must cover: the configured ones, then those of the accepted packs. */
export function reviewLenses(config: SdlcConfig, lenses: PackLens[]): string[] {
  return [...new Set([...config.review.lenses, ...lenses.map((lens) => lens.id)])];
}

/** A pack check as one of `verify.commands`, run as the agent `pack-<name>` (never as the person running verify). */
function asVerifyCommand(check: PackCheck): VerifyCommand {
  const timeout = check.timeoutSeconds === undefined ? {} : { timeoutSeconds: check.timeoutSeconds };
  const env = { SDLC_AGENT: `pack-${check.pack}` };
  return { name: check.name, run: check.run, required: check.required, ...timeout, env };
}

/** `ctx` with the checks of the accepted packs after its own `verify.commands`; the config file is not touched. */
export function withPackChecks<T extends { root: string; config: SdlcConfig }>(ctx: T): T {
  const checks = packChecks(ctx.root, ctx.config);
  if (checks.length === 0) return ctx;
  const commands = [...ctx.config.verify.commands, ...checks.map(asVerifyCommand)];
  return { ...ctx, config: { ...ctx.config, verify: { ...ctx.config.verify, commands } } };
}

/** The pack's lenses, workflows and checks for `team sync`; undefined when it brings none and nothing is refused. */
export function contentsReport(root: string, pack: PackConfig, fetched: FetchedPack): PackContentsReport | undefined {
  const contents = readPackContents(fetched.dir, pack);
  const { lenses, workflows, checks, problems } = contents;
  if (lenses.length + workflows.length + checks.length + problems.length === 0) return undefined;
  const accepted = isInEffect(readTeam(root).packs?.[pack.name], fetched, contents);
  return {
    lenses: lenses.map((lens) => lens.id),
    workflows: workflows.map((workflow) => workflow.name),
    checks: checks.map((check) => check.name),
    problems,
    accepted,
  };
}