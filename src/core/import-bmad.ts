import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { toPosix } from './fs-utils.js';
import {
  note, renderDelta, renderDesign, renderIntent, renderProposal, section, slug,
  type Requirement, type Sections,
} from './import-bmad-render.js';

export type BmadKind = 'prd' | 'spec' | 'architecture';
export interface BmadDoc {
  kind: BmadKind;
  /** Path relative to the project root, POSIX. */
  path: string;
  title: string;
}
export interface ImportedFile {
  /** Path relative to the change folder, POSIX. */
  path: string;
  content: string;
}
export interface BmadImportPlan {
  change: string;
  docs: BmadDoc[];
  files: ImportedFile[];
  capabilities: string[];
  /** Items for `openspec/deferred-work.md`. */
  deferred: Array<{ title: string; why: string }>;
  /** Sections found in the sources that have no place in the change. */
  unmapped: Array<{ doc: string; section: string }>;
  warnings: string[];
}

function walkMarkdown(target: string, files: string[]): void {
  if (fs.lstatSync(target).isSymbolicLink()) return;
  if (fs.statSync(target).isDirectory()) {
    for (const entry of fs.readdirSync(target).sort()) {
      walkMarkdown(path.join(target, entry), files);
    }
    return;
  }
  if (target.endsWith('.md')) files.push(target);
}

function identifyDoc(root: string, file: string): BmadDoc[] {
  const body = fs.readFileSync(file, 'utf8');
  const frontmatter = body.split('---', 3)[1] ?? '';
  const kind: BmadKind | undefined = /^id:\s*SPEC-/m.test(frontmatter) ? 'spec'
    : /^# PRD:\s*/m.test(body) ? 'prd'
    : /^# Architecture Spine\s*[—-]/m.test(body) ? 'architecture' : undefined;
  if (!kind) return [];
  const heading = body.match(/^# (?:PRD:\s*|Architecture Spine\s*[—-]\s*)?(.+)$/m);
  const title = (heading?.[1] ?? path.basename(file)).trim();
  return [{ kind, path: toPosix(path.relative(root, file)), title }];
}

/** Finds BMAD artifacts by content, recursively in a file or folder. */
export function detectBmadDocs(root: string, input: string): BmadDoc[] {
  const start = path.resolve(root, input);
  const files: string[] = [];
  try {
    walkMarkdown(start, files);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new SdlcError('no_bmad_artifacts', { key: 'error.no_bmad_artifacts_found' });
  }
  const docs = files.flatMap((file) => identifyDoc(root, file));
  if (!docs.length) throw new SdlcError('no_bmad_artifacts', { key: 'error.no_bmad_artifacts_found' });
  return docs;
}

export function sections(body: string): Sections {
  const result: Sections = new Map();
  const headings = [...body.matchAll(/^##\s+(?:\d+\.\s*)?(.+)$/gm)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const end = headings[index + 1]?.index;
    result.set(heading[1].trim(), body.slice(heading.index! + heading[0].length, end).trim());
  }
  return result;
}

export function requirementsFromSpec(spec: Sections): Requirement[] {
  const capabilities = section(spec, 'Capabilities');
  const pattern = /^- \*\*(CAP-\d+)\*\*\s*\n\s+- \*\*intent:\*\* (.+)\n\s+- \*\*success:\*\* (.+)/gm;
  return [...capabilities.matchAll(pattern)].map((match) => ({
    id: match[1],
    name: match[2].replace(/[.!]$/, ''),
    intent: match[2],
    successes: [match[3]],
    group: slug(match[2].split(/\s+/).slice(0, 4).join(' ')),
  }));
}

export function requirementsFromPrd(body: string): Requirement[] {
  const requirements: Requirement[] = [];
  const pattern = /^(### 4\.\d+ (.+)|#### (FR-\d+): (.+))$/gm;
  let group = 'features';
  for (const match of body.matchAll(pattern)) {
    if (match[2]) {
      group = slug(match[2]);
      continue;
    }
    const tail = body.slice(match.index! + match[0].length).split(/^#### |^### |^## /m)[0];
    const successes = [...tail.matchAll(/^- (.+)$/gm)].map((item) => item[1]);
    requirements.push({
      id: match[3], name: match[4], intent: tail.split('**Consequences')[0].trim(),
      successes, group,
    });
  }
  return requirements;
}

function groupRequirements(requirements: Requirement[]): Map<string, Requirement[]> {
  const groups = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    groups.set(requirement.group, [...(groups.get(requirement.group) ?? []), requirement]);
  }
  return groups;
}

function deferredFromArchitecture(architecture: Sections): Array<{ title: string; why: string }> {
  return section(architecture, 'Deferred').split('\n').filter((line) => /^- /.test(line)).map((line) => {
    const [title, why] = line.slice(2).split(/\s+—\s+|\s+-\s+/, 2);
    return { title: title.replace(/\.$/, ''), why: why || 'Deferred in the BMAD architecture' };
  });
}

function unmappedSections(docs: BmadDoc[], maps: Sections[]): Array<{ doc: string; section: string }> {
  const used: Record<BmadKind, string[]> = {
    prd: ['Vision', 'Target User', 'Features', 'Non-Goals', 'MVP Scope', 'Success Metrics', 'Open Questions'],
    spec: ['Why', 'Capabilities', 'Constraints', 'Non-goals', 'Success signal', 'Assumptions', 'Open Questions'],
    architecture: ['Design Paradigm', 'Invariants', 'Stack', 'Deferred'],
  };
  return docs.flatMap((doc, index) => [...maps[index].keys()]
    .filter((key) => !used[doc.kind].some((name) => key.toLowerCase().startsWith(name.toLowerCase())))
    .map((key) => ({ doc: doc.path, section: key })));
}

function buildFiles(
  origin: BmadDoc, prd: BmadDoc | undefined, spec: BmadDoc | undefined,
  arch: BmadDoc | undefined, prdSections: Sections, specSections: Sections,
  archSections: Sections, archBody: string, groups: Map<string, Requirement[]>,
  requirements: Requirement[],
): ImportedFile[] {
  const files: ImportedFile[] = [];
  const add = (file: string, content: string, doc: BmadDoc) => {
    files.push({ path: file, content: note(doc) + content.trim() + '\n' });
  };
  add('intent.md', renderIntent(origin.title, prdSections, specSections), origin);
  for (const [group, items] of groups) {
    add('specs/' + group + '/spec.md', renderDelta(origin.title, items), spec ?? prd!);
  }
  const why = section(specSections, 'Why') || section(prdSections, 'Vision');
  add('proposal.md', renderProposal(why, requirements, groups), spec ?? prd ?? arch!);
  if (arch) add('design.md', renderDesign(archSections, archBody), arch);
  return files;
}

/** Builds the files of the change without writing anything. */
export function planBmadImport(root: string, input: string, change: string): BmadImportPlan {
  const docs = detectBmadDocs(root, input);
  const find = (kind: BmadKind) => docs.find((doc) => doc.kind === kind);
  const prd = find('prd');
  const spec = find('spec');
  const arch = find('architecture');
  const body = (doc?: BmadDoc) => doc ? fs.readFileSync(path.resolve(root, doc.path), 'utf8') : '';
  const prdBody = body(prd);
  const archBody = body(arch);
  const prdSections = sections(prdBody);
  const specSections = sections(body(spec));
  const archSections = sections(archBody);
  const origin = prd ?? spec ?? arch!;
  const requirements = spec ? requirementsFromSpec(specSections) : requirementsFromPrd(prdBody);
  const groups = groupRequirements(requirements);
  const files = buildFiles(
    origin, prd, spec, arch, prdSections, specSections, archSections, archBody, groups, requirements,
  );
  const maps = docs.map((doc) => doc.kind === 'prd' ? prdSections
    : doc.kind === 'spec' ? specSections : archSections);
  return {
    change, docs, files, capabilities: [...groups.keys()],
    deferred: deferredFromArchitecture(archSections),
    unmapped: unmappedSections(docs, maps), warnings: [],
  };
}
