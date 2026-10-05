import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import type { ProjectContext } from '../cli/context.js';
import { APPROVAL_GATES, saveConfig, type SdlcConfig, type VerifyCommand } from './config.js';
import { isFile, isWithin, listFilesRecursive, readText } from './fs-utils.js';
import { formatIdentity, git, gitIdentity } from './git.js';
import { appendLog } from './log.js';
import { DEFAULT_SEPARATION, ROLES_PATH } from './roles.js';
import { detectVerifyCommands } from './verify.js';
import { writeYaml } from './yaml-io.js';

interface AdoptPerson {
  id: string;
  name: string;
  email: string;
  commits: number;
  /** `identity`: the person running the command (git user.email), added so the roles have a holder. */
  sources: ('git' | 'codeowners' | 'identity')[];
}

/** An owner of narrower CODEOWNERS patterns: not a repository-wide code-owner, listed for a person to check. */
interface ScopedOwner {
  owner: string;
  patterns: string[];
}

interface AdoptRoles {
  path: string;
  exists: boolean;
  /** `legacy_roles`: sdlc.yaml keeps roles; nothing is proposed or written until `sdlc roles migrate`. */
  skip?: 'legacy_roles';
  people: AdoptPerson[];
  roles: Record<string, string[]>;
  /** Roles given to the person running the command for want of a better holder; a person checks them. */
  to_check: string[];
}

interface AdoptProposal {
  verify: { commands: VerifyCommand[] };
  enforcement: { protected_paths: string[]; test_paths: string[] };
  roles: AdoptRoles;
}

interface CodeOwners {
  paths: string[];
  unresolved: string[];
  /** Emails and handles that own the whole repository (`*`, `/*`, `**`, `/**`). */
  catchAll: Set<string>;
  scoped: ScopedOwner[];
}

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const CODEOWNERS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const CATCH_ALL = new Set(['*', '/*', '**', '/**']);

function safeFile(root: string, relative: string): boolean {
  const file = path.resolve(root, relative);
  if (!isWithin(root, file) || !isFile(file)) return false;
  return isWithin(fs.realpathSync(root), fs.realpathSync(file));
}

function safeDirectory(root: string, relative: string): boolean {
  const directory = path.resolve(root, relative);
  if (!isWithin(root, directory) || !fs.existsSync(directory)) return false;
  return isWithin(fs.realpathSync(root), fs.realpathSync(directory));
}

function stack(root: string): { id: string; evidence: string[] }[] {
  const files = fs.readdirSync(root);
  const rules: [string, string[]][] = [
    ['node', ['package.json']],
    ['go', ['go.mod']],
    ['python', ['pyproject.toml', 'requirements.txt', 'setup.py']],
    ['rust', ['Cargo.toml']],
    ['java', ['pom.xml', ...files.filter((file) => /^build\.gradle(\..+)?$/.test(file))]],
    ['dotnet', files.filter((file) => /\.(csproj|sln)$/.test(file))],
  ];
  return rules.map(([id, names]) => ({ id, evidence: names.filter((name) => safeFile(root, name)) }))
    .filter((entry) => entry.evidence.length > 0);
}

function ciFiles(root: string): string[] {
  const workflow = '.github/workflows';
  const candidates = ['.gitlab-ci.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.circleci/config.yml'];
  if (safeDirectory(root, workflow)) {
    candidates.push(...listFilesRecursive(path.join(root, workflow))
      .filter((file) => !file.includes('/') && /\.ya?ml$/.test(file))
      .map((file) => `${workflow}/${file}`));
  }
  return candidates.filter((file) => safeFile(root, file)).sort();
}

/** Bots commit and own files too, but they never approve: `dependabot[bot]`, `...@users.noreply.github.com`. */
function isBot(name: string, email: string): boolean {
  const bracketed = /\[bot\]/i;
  return bracketed.test(name) || bracketed.test(email) || email.includes('noreply');
}

function gitPeople(root: string): Map<string, AdoptPerson> {
  const people = new Map<string, AdoptPerson>();
  const result = git(root, ['log', '--format=%aN%x1f%aE']);
  if (!result.ok) return people;
  for (const row of result.stdout.split('\n')) {
    const [name, rawEmail] = row.split('\x1f');
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !EMAIL.test(email) || isBot(name ?? '', email)) continue;
    const person = people.get(email);
    if (person) {
      person.commits++;
    } else {
      people.set(email, { id: '', name: name?.trim() || email, email, commits: 1, sources: ['git'] });
    }
  }
  return people;
}

/** A CODEOWNERS owner: an `@handle` as written, an email in lower case; anything else is ignored. */
function ownerToken(token: string): string | undefined {
  if (token.startsWith('@')) return token;
  const email = token.toLowerCase();
  return EMAIL.test(email) ? email : undefined;
}

function ownerRows(root: string, files: string[]): { pattern: string; owners: string[] }[] {
  const rows: { pattern: string; owners: string[] }[] = [];
  for (const file of files) {
    for (const row of (readText(path.join(root, file)) ?? '').split(/\r?\n/)) {
      const tokens = row.trim().split(/\s+/);
      if (!tokens[0] || tokens[0].startsWith('#')) continue;
      const comment = tokens.findIndex((token) => token.startsWith('#'));
      const owners = tokens.slice(1, comment < 0 ? undefined : comment)
        .map(ownerToken)
        .filter((owner): owner is string => owner !== undefined);
      rows.push({ pattern: tokens[0], owners });
    }
  }
  return rows;
}

function noteOwner(people: Map<string, AdoptPerson>, email: string): void {
  if (isBot('', email)) return;
  const person = people.get(email);
  if (!person) {
    people.set(email, { id: '', name: email, email, commits: 0, sources: ['codeowners'] });
  } else if (!person.sources.includes('codeowners')) {
    person.sources.push('codeowners');
  }
}

function addOwners(root: string, people: Map<string, AdoptPerson>): CodeOwners {
  const paths = CODEOWNERS.filter((file) => safeFile(root, file));
  const unresolved = new Set<string>();
  const catchAll = new Set<string>();
  const scoped = new Map<string, Set<string>>();
  for (const row of ownerRows(root, paths)) {
    for (const owner of row.owners) {
      if (owner.startsWith('@')) unresolved.add(owner);
      else noteOwner(people, owner);
      if (CATCH_ALL.has(row.pattern)) {
        catchAll.add(owner);
      } else {
        scoped.set(owner, (scoped.get(owner) ?? new Set<string>()).add(row.pattern));
      }
    }
  }
  const narrower = [...scoped.entries()]
    .filter(([owner]) => !catchAll.has(owner))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, patterns]) => ({ owner, patterns: [...patterns] }));
  return { paths, unresolved: [...unresolved].sort(), catchAll, scoped: narrower };
}

/** The person running the command, added to the people when missing; undefined without a usable git email. */
function addRunner(root: string, people: Map<string, AdoptPerson>): string | undefined {
  const identity = gitIdentity(root);
  const email = identity.email?.trim().toLowerCase();
  if (!email || !EMAIL.test(email)) return undefined;
  if (!people.has(email)) {
    people.set(email, { id: '', name: identity.name?.trim() || email, email, commits: 0, sources: ['identity'] });
  }
  return email;
}

function assignIds(people: AdoptPerson[]): void {
  const used = new Set<string>();
  for (const person of people) {
    const base = person.email.split('@')[0].normalize('NFKD').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    person.id = id;
    used.add(id);
  }
}

function testPaths(root: string, configured: string[]): string[] {
  const candidates = ['test/**', 'tests/**', 'src/test/**', 'src/tests/**', 'src/__tests__/**'];
  return candidates.filter((glob) => {
    const directory = glob.slice(0, -3);
    const files = safeDirectory(root, directory)
      ? listFilesRecursive(path.join(root, directory)).map((file) => `${directory}/${file}`)
      : [];
    const safe = files.filter((file) => safeFile(root, file));
    return safe.length > 0 && safe.some((file) => !configured.some((pattern) => picomatch(pattern)(file)));
  });
}

/** Every role a gate accepts (high-risk extras included), then code-owner and maintainer, each once. */
function neededRoles(config: SdlcConfig): string[] {
  const gates = APPROVAL_GATES.flatMap((gate) => [
    ...config.gates[gate].approvers,
    ...config.gates[gate].highRiskApprovers,
  ]);
  return [...new Set([...gates, 'code-owner', 'maintainer'])];
}

/** Roles kept in sdlc.yaml (`roles:` with members) win until a person runs `sdlc roles migrate`. */
function legacyRoles(config: SdlcConfig): boolean {
  return Object.values(config.roles).some((members) => members.length > 0);
}

function proposeRoles(ctx: ProjectContext, people: AdoptPerson[], owners: CodeOwners, runner?: string): AdoptRoles {
  const base = { path: ROLES_PATH, exists: safeFile(ctx.root, ROLES_PATH), people };
  if (legacyRoles(ctx.config)) {
    return { ...base, skip: 'legacy_roles', roles: {}, to_check: [] };
  }
  const codeOwners = people.filter((person) => owners.catchAll.has(person.email)).map((person) => person.id);
  const self = people.find((person) => person.email === runner)?.id;
  const roles: Record<string, string[]> = {};
  const toCheck: string[] = [];
  for (const role of neededRoles(ctx.config)) {
    if (role === 'code-owner' && codeOwners.length > 0) {
      roles[role] = codeOwners;
    } else if (self) {
      roles[role] = [self];
      toCheck.push(role);
    }
  }
  return { ...base, roles, to_check: toCheck };
}

function protectedPaths(ctx: ProjectContext, ci: string[], owners: string[]): string[] {
  const candidates = [
    ...ci.map((file) => file.startsWith('.github/workflows/') ? '.github/workflows/**' : file),
    ...owners,
  ];
  return [...new Set(candidates)].filter((file) => !ctx.config.enforcement.protectedPaths.includes(file));
}

function verifyCommands(ctx: ProjectContext): VerifyCommand[] {
  const configuredRuns = new Set(ctx.config.verify.commands.map((command) => command.run));
  return detectVerifyCommands(ctx.root)
    .filter((command) => !configuredRuns.has(command.run))
    .map(({ name, run }) => ({ name, run, required: true }));
}

export function analyzeAdoption(ctx: ProjectContext) {
  const peopleMap = gitPeople(ctx.root);
  const owners = addOwners(ctx.root, peopleMap);
  const runner = addRunner(ctx.root, peopleMap);
  const people = [...peopleMap.values()].sort((a, b) => b.commits - a.commits || a.email.localeCompare(b.email));
  assignIds(people);
  const ci = ciFiles(ctx.root);
  const proposal: AdoptProposal = {
    verify: { commands: verifyCommands(ctx) },
    enforcement: {
      protected_paths: protectedPaths(ctx, ci, owners.paths),
      test_paths: testPaths(ctx.root, ctx.config.enforcement.testPaths),
    },
    roles: proposeRoles(ctx, people, owners, runner),
  };
  return {
    stack: stack(ctx.root),
    ci,
    people,
    owners_unresolved: owners.unresolved,
    owners_scoped: owners.scoped,
    proposal,
    apply: 'sdlc adopt --apply',
    harness: ctx.stamp,
  };
}

function writeRoles(file: string, proposal: AdoptRoles): void {
  const people = Object.fromEntries(proposal.people.map((person) => [
    person.id, { name: person.name, emails: [person.email] },
  ]));
  const separation = {
    author_cannot_approve: DEFAULT_SEPARATION.authorCannotApprove,
    distinct_approvers: DEFAULT_SEPARATION.distinctApprovers,
    max_gates_per_person: DEFAULT_SEPARATION.maxGatesPerPerson,
  };
  writeYaml(file, { version: 1, signing: 'off', people, roles: proposal.roles, separation });
}

export function applyAdoption(ctx: ProjectContext, proposal: AdoptProposal): boolean {
  const { commands } = proposal.verify;
  const { protected_paths: protectedPaths, test_paths: testPaths } = proposal.enforcement;
  const configChanged = commands.length + protectedPaths.length + testPaths.length > 0;
  if (configChanged) {
    ctx.config.verify.commands.push(...commands);
    ctx.config.enforcement.protectedPaths.push(...protectedPaths);
    ctx.config.enforcement.testPaths.push(...testPaths);
    saveConfig(ctx.paths.sdlcConfig, ctx.config);
  }
  const rolesFile = path.join(ctx.root, ROLES_PATH);
  // Legacy roles stay in sdlc.yaml: a roles.yaml next to them would silently replace them.
  const rolesChanged = !proposal.roles.skip && !fs.existsSync(rolesFile);
  if (rolesChanged) {
    writeRoles(rolesFile, proposal.roles);
  }
  if (configChanged || rolesChanged) {
    appendLog(ctx.root, ctx.config, {
      event: 'adopt.applied',
      by: formatIdentity(gitIdentity(ctx.root)),
      detail: 'project settings and roles drafted',
    }, ctx.stamp);
  }
  return configChanged || rolesChanged;
}