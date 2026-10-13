import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { normalizeNewlines } from '../core/fs-utils.js';
import { callsHumanCommand } from '../core/human-command-match.js';
import { clearsAgentMarker } from '../core/policy-markers.js';
import { splitFrontmatter, WORKFLOW_IDS } from '../integrations/assets.js';
import { isGitPack, packPinned, type PackConfig } from './pack-config.js';
import { ROLE_ID } from './role-file.js';
import { LIMITS } from './vetting.js';

/**
 * What a pack brings besides roles and skills (B18), read from its fetched copy as plain files (links are not
 * followed, each file at most LIMITS.fileBytes):
 * - `lenses/<id>.md`: a review lens, `<pack>-<id>` in the project;
 * - `workflows/<id>.md`: a workflow with `description` in its front matter, generated as the skill
 *   `sdlc-<pack>-<id>`; it can never take the name of a built-in workflow;
 * - `checks.yaml`: `verify:` entries in the format of `verify.commands`, `<pack>/<name>` in the project.
 * `digest` covers exactly these files, so a person's acceptance is bound to their content. `problems` say why the
 * pack cannot be accepted: not pinned while it brings workflows or checks, a person's command in a check or a
 * workflow, or a file that is not what its folder expects.
 */
export interface PackLens {
  id: string;
  pack: string;
  text: string;
}

export interface PackWorkflow {
  name: string;
  pack: string;
  description: string;
  body: string;
}

export interface PackCheck {
  name: string;
  pack: string;
  run: string;
  required: boolean;
  timeoutSeconds?: number;
}

export type PackProblemCode = 'pack_not_pinned' | 'pack_forbidden_command' | 'pack_invalid_content';

export interface PackProblem {
  code: PackProblemCode;
  item: string;
  detail: string;
}

export interface PackContents {
  lenses: PackLens[];
  workflows: PackWorkflow[];
  checks: PackCheck[];
  digest: string;
  problems: PackProblem[];
}

interface PackFile {
  rel: string;
  id: string;
  text: string;
}

type Raw = Record<string, unknown>;

/** A lens id as a coverage line of review.md can name it (`parseCoverage`): lower-case letters joined by `-`. */
const LENS_ID = /^[a-z]+(?:-[a-z]+)*$/;
const CHECK_NAME = /^[A-Za-z0-9][\w.-]*$/;
const BUILTIN_SKILLS = new Set<string>(WORKFLOW_IDS.map((id) => `sdlc-${id}`));
const DETAIL_MAX = 120;

function isRaw(value: unknown): value is Raw {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function plainEntry(file: string, kind: 'file' | 'dir'): boolean {
  try {
    const stat = fs.lstatSync(file);
    return kind === 'file' ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

function invalid(item: string, detail: string): PackProblem {
  return { code: 'pack_invalid_content', item, detail };
}

function forbidden(item: string, detail: string): PackProblem {
  return { code: 'pack_forbidden_command', item, detail: detail.slice(0, DETAIL_MAX) };
}

function notPinned(pack: PackConfig): PackProblem {
  const item = isGitPack(pack) ? `ref ${pack.ref}` : `npm ${pack.npm}`;
  const detail = 'a pack with workflows or checks needs a git commit of 40 hex digits or an exact npm version';
  return { code: 'pack_not_pinned', item, detail };
}

/** One file of the pack, newlines normalized; an oversized file is a problem and is not read. */
function readPackFile(file: string, rel: string, problems: PackProblem[]): PackFile[] {
  if (fs.lstatSync(file).size > LIMITS.fileBytes) {
    problems.push(invalid(rel, `larger than ${LIMITS.fileBytes} bytes`));
    return [];
  }
  const text = normalizeNewlines(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '');
  return [{ rel, id: path.posix.basename(rel).replace(/\.(?:md|yaml)$/, ''), text }];
}

/** The `.md` files directly in `<dir>/<folder>`, sorted by name; links and folders are skipped. */
function markdownFiles(dir: string, folder: string, problems: PackProblem[]): PackFile[] {
  const base = path.join(dir, folder);
  if (!plainEntry(base, 'dir')) return [];
  const names = fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  return names.flatMap((name) => readPackFile(path.join(base, name), `${folder}/${name}`, problems));
}

function checksFile(dir: string, problems: PackProblem[]): PackFile | undefined {
  const file = path.join(dir, 'checks.yaml');
  return plainEntry(file, 'file') ? readPackFile(file, 'checks.yaml', problems)[0] : undefined;
}

/** `sha256:` of the files as `[path, text]` pairs in the order read: unambiguous whatever the texts hold. */
function digestOf(files: PackFile[]): string {
  const pairs = files.map((file) => [file.rel, file.text]);
  return `sha256:${createHash('sha256').update(JSON.stringify(pairs)).digest('hex')}`;
}

function lensesOf(pack: string, files: PackFile[], problems: PackProblem[]): PackLens[] {
  const lenses: PackLens[] = [];
  for (const file of files) {
    const id = `${pack}-${file.id}`;
    if (LENS_ID.test(file.id) && LENS_ID.test(id)) lenses.push({ id, pack, text: file.text });
    else problems.push(invalid(file.rel, `${id} is not a lens id (lower-case letters joined by -)`));
  }
  return lenses;
}

function frontMatter(text: string): { data: Raw; body: string } | undefined {
  try {
    const split = splitFrontmatter(text);
    return isRaw(split.data) ? { data: split.data, body: split.body } : undefined;
  } catch {
    return undefined;
  }
}

/** Why the workflow file cannot be a workflow skill, or undefined. */
function workflowProblem(name: string, file: PackFile): string | undefined {
  if (!ROLE_ID.test(file.id)) return 'not a workflow id (lower-case words joined by -)';
  if (BUILTIN_SKILLS.has(name)) return `${name} is the name of a built-in workflow`;
  const description = frontMatter(file.text)?.data.description;
  if (typeof description !== 'string' || description.trim() === '') return 'no description in its front matter';
  return undefined;
}

function workflowOf(pack: string, file: PackFile, problems: PackProblem[]): PackWorkflow[] {
  const name = `sdlc-${pack}-${file.id}`;
  const problem = workflowProblem(name, file);
  if (problem) {
    problems.push(invalid(file.rel, problem));
    return [];
  }
  if (callsHumanCommand(file.text)) {
    problems.push(forbidden(file.rel, 'the workflow calls a human-only sdlc command'));
    return [];
  }
  const parsed = frontMatter(file.text) as { data: Raw; body: string };
  return [{ name, pack, description: String(parsed.data.description).trim(), body: parsed.body }];
}

/** The entries of `verify:` in checks.yaml, or none (and the problem) when the file is not such a list. */
function checkEntries(file: PackFile, problems: PackProblem[]): unknown[] {
  let raw: unknown;
  try {
    raw = parse(file.text);
  } catch {
    problems.push(invalid(file.rel, 'not valid YAML'));
    return [];
  }
  const verify = isRaw(raw) ? raw.verify : undefined;
  if (Array.isArray(verify)) return verify;
  problems.push(invalid(file.rel, 'needs a verify: list'));
  return [];
}

/** Why a check entry is not one of `verify.commands`, or undefined. */
function checkProblem(name: string, run: string, raw: Raw): string | undefined {
  if (run === '') return 'run is required';
  if (!CHECK_NAME.test(name)) return `${JSON.stringify(name.slice(0, 40))} is not a check name`;
  if (raw.required !== undefined && typeof raw.required !== 'boolean') return 'required must be true or false';
  const timeout = raw.timeout_seconds;
  const badTimeout = typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0;
  if (timeout !== undefined && badTimeout) return 'timeout_seconds must be a positive number';
  return undefined;
}

/** One check: a mapping `{ name, run, required?, timeout_seconds? }` or, as in `verify.commands`, a command line. */
function checkOf(pack: string, value: unknown, item: string, problems: PackProblem[]): PackCheck[] {
  const raw = typeof value === 'string' ? { run: value, name: value.trim().split(/\s+/)[0] } : value;
  if (!isRaw(raw)) {
    problems.push(invalid(item, 'must be a mapping with name and run'));
    return [];
  }
  const run = typeof raw.run === 'string' ? raw.run.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const problem = checkProblem(name, run, raw);
  if (problem) {
    problems.push(invalid(item, problem));
    return [];
  }
  if (callsHumanCommand(run) || clearsAgentMarker(run)) {
    problems.push(forbidden(item, run));
    return [];
  }
  const timeout = typeof raw.timeout_seconds === 'number' ? { timeoutSeconds: raw.timeout_seconds } : {};
  return [{ name: `${pack}/${name}`, pack, run, required: raw.required !== false, ...timeout }];
}

function checksOf(pack: string, file: PackFile | undefined, problems: PackProblem[]): PackCheck[] {
  if (!file) return [];
  const checks: PackCheck[] = [];
  checkEntries(file, problems).forEach((value, index) => {
    const item = `${file.rel} verify[${index}]`;
    const found = checkOf(pack, value, item, problems);
    if (found.length > 0 && checks.some((check) => check.name === found[0].name)) {
      problems.push(invalid(item, `${found[0].name} is listed twice`));
    } else checks.push(...found);
  });
  return checks;
}

/** The lenses, workflows and checks of the pack fetched into `dir`, their digest, and why it cannot be accepted. */
export function readPackContents(dir: string, pack: PackConfig): PackContents {
  const problems: PackProblem[] = [];
  const lensFiles = markdownFiles(dir, 'lenses', problems);
  const workflowFiles = markdownFiles(dir, 'workflows', problems);
  const checks = checksFile(dir, problems);
  const files = [...lensFiles, ...workflowFiles, ...(checks ? [checks] : [])];
  const contents: PackContents = {
    lenses: lensesOf(pack.name, lensFiles, problems),
    workflows: workflowFiles.flatMap((file) => workflowOf(pack.name, file, problems)),
    checks: checksOf(pack.name, checks, problems),
    digest: digestOf(files),
    problems,
  };
  const bringsCode = workflowFiles.length > 0 || checks !== undefined;
  if (bringsCode && !packPinned(pack)) problems.unshift(notPinned(pack));
  return contents;
}