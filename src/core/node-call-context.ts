import { inlineMutations, unchangedInlineCall, type InlineMutations } from './inline-mutations.js';
import { readOnlyFileOpening } from './node-read-options.js';
import { nodeArgumentEnd, nodeLiteralValue } from './node-literal.js';
import { nodeCallPrefix } from './node-call-prefix.js';
import { namespaceEscape } from './node-capabilities.js';

const FS_MODULE = String.raw`['"](?:node:)?fs(?:/promises)?['"]`;
const FS_REQUIRE = String.raw`require\s*\(\s*${FS_MODULE}\s*\)`;
const DIRECT_FS = new RegExp(String.raw`^${FS_REQUIRE}(?:\s*\.\s*promises)?\s*\.\s*$`);
const FILE_WRITER = new RegExp(
  '^(?:writeFile|appendFile|createWriteStream|mkdir|mkdtemp|rm|rmdir|unlink|truncate|'
  + 'chmod|chown|lchmod|lchown|utimes|lutimes)(?:Sync)?$',
);
const FILE_PAIR = /^(?:copyFile|cp|rename|link|symlink)(?:Sync)?$/;
const FS_READER = /^(?:readFile|readlink|readdir|stat|lstat|realpath|exists|access|close)(?:Sync)?$/;
const CONTROL = /^(?:if|while|switch|catch|for)$/;

interface FsBindings {
  namespaces: Set<string>;
  functions: Set<string>;
  declarations: { start: number; end: number }[];
  unsupported: boolean;
}

export interface NodeCall {
  name: string;
  index: number;
  after: number;
  understood: boolean;
  file: boolean;
  module: boolean;
  receiverAt: number;
}

export interface NodeCallContext {
  mutations: InlineMutations;
  calls: NodeCall[];
  callsByIndex: ReadonlyMap<number, NodeCall>;
  opaque: boolean;
  problem?: string;
  targets: string[];
}

function namespaceBindings(
  source: string, mutations: InlineMutations,
): Pick<FsBindings, 'namespaces' | 'declarations'> {
  const namespaces = new Set<string>();
  const declarations: FsBindings['declarations'] = [];
  const end = String.raw`(?=[^\S\r\n\u2028\u2029]*(?:[;,)}\r\n\u2028\u2029]|$))`;
  const declaration = new RegExp(String.raw`\b(?:const|let|var)\s+([\w$]+)\s*=\s*${FS_REQUIRE}(?:\s*\.\s*promises)?${end}`, 'g');
  const imports = new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([\w$]+)\s+from\s+${FS_MODULE}`, 'g');
  const counts = new Map<string, number>();
  for (const match of source.matchAll(/\b(?:const|let|var|import)\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)(?![\w$])/g)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  for (const match of [...source.matchAll(declaration), ...source.matchAll(imports)]) {
    const name = match[1];
    if (!mutations.bindings.has(name) && counts.get(name) === 1) namespaces.add(name);
    declarations.push({ start: match.index!, end: match.index! + match[0].length });
  }
  return { namespaces, declarations };
}

/** Only literal standard namespaces and stable, simple bindings establish a callable's provenance. */
function fsBindings(source: string, mutations: InlineMutations): FsBindings {
  const { namespaces, declarations } = namespaceBindings(source, mutations);
  const functions = new Set<string>();
  let unsupported = false;
  const destructured = new RegExp(String.raw`\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*${FS_REQUIRE}`, 'g');
  const namedImports = new RegExp(String.raw`\bimport\s*\{([^{}]*)\}\s+from\s+${FS_MODULE}`, 'g');
  for (const match of [...source.matchAll(destructured), ...source.matchAll(namedImports)]) {
    declarations.push({ start: match.index!, end: match.index! + match[0].length });
    for (const entry of match[1].split(',').map(value => value.trim())) {
      if (!entry) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(entry)) unsupported = true;
      if (/^[A-Za-z_$][\w$]*$/.test(entry) && !mutations.names.has(entry)) {
        if (entry === 'promises') namespaces.add(entry);
        else functions.add(entry);
      }
    }
  }
  declarations.sort((left, right) => left.start - right.start);
  const importsAt = new Set(declarations.map(span => span.start));
  unsupported ||= [...source.matchAll(/\bimport\b/g)].some(match => !importsAt.has(match.index!));
  return { namespaces, functions, declarations, unsupported };
}

function filesystemReceiver(prefix: string, namespaces: Set<string>): boolean {
  if (DIRECT_FS.test(prefix)) return true;
  const receiver = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*promises)?\s*\.\s*$/.exec(prefix);
  return receiver !== null && namespaces.has(receiver[1]);
}

function standardDataCall(name: string, prefix: string, mutations: InlineMutations): boolean {
  const receiver = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*$/.exec(prefix)?.[1].replace(/\s/g, '');
  if (!receiver || mutations.names.has(receiver.split('.')[0])) return false;
  if (receiver === 'console') return /^(?:log|info|warn|error|debug)$/.test(name);
  if (/^process\.(?:stdout|stderr)$/.test(receiver)) return name === 'write';
  if (receiver === 'JSON') return /^(?:stringify|parse)$/.test(name);
  if (receiver === 'Object') return /^(?:keys|values|entries|is|hasOwn)$/.test(name);
  return receiver === 'Math' && /^(?:abs|ceil|floor|round|trunc|min|max|random|sqrt|pow|sign)$/.test(name);
}

function literalArgument(
  code: string, after: number, mutations: InlineMutations,
): { value: string; after: number } | undefined {
  const start = after + (code.slice(after).match(/^\s*/)?.[0].length ?? 0);
  const literal = mutations.literalsByIndex.get(start);
  if (!literal || !/^\s*[,)]/.test(code.slice(literal.end))) return undefined;
  const value = nodeLiteralValue(literal.value);
  if (value === undefined || /[$`~%]/.test(value)) return undefined;
  return { value, after: literal.end };
}

function fileArguments(code: string, call: NodeCall, mutations: InlineMutations): string[] | undefined {
  const first = literalArgument(code, call.after, mutations);
  if (!first) return undefined;
  if (!FILE_PAIR.test(call.name)) return [first.value];
  const comma = first.after + (code.slice(first.after).match(/^\s*,/)?.[0].length ?? 0);
  const second = literalArgument(code, comma, mutations);
  return second ? /^(?:rename|link|symlink)/.test(call.name) ? [first.value, second.value] : [second.value] : undefined;
}

/** A JSON reviver/replacer is executable input, unlike omitted or literal non-callable arguments. */
function callbackProblem(code: string, call: NodeCall, mutations: InlineMutations): string | undefined {
  if (!/^(?:parse|stringify)$/.test(call.name)
    || !/^JSON\s*\.\s*$/.test(nodeCallPrefix(mutations.source, call.index).text)) return undefined;
  const firstEnd = nodeArgumentEnd(mutations.source, call.after);
  if (firstEnd === undefined || code[firstEnd] !== ',') return undefined;
  const secondEnd = nodeArgumentEnd(mutations.source, firstEnd + 1);
  const value = code.slice(firstEnd + 1, secondEnd).trim();
  if (/^(?:null|true|false|-?(?:\d+(?:\.\d*)?|\.\d+))$/.test(value)) return undefined;
  if (value === 'undefined' && mutations.intrinsicUndefined) return undefined;
  const start = firstEnd + 1 + (code.slice(firstEnd + 1).match(/^\s*/)?.[0].length ?? 0);
  const literal = mutations.literalsByIndex.get(start);
  if (literal && literal.end <= (secondEnd ?? 0) && code.slice(literal.end, secondEnd).trim() === '') return undefined;
  return 'Cannot statically resolve an executable inline JSON callback.';
}

/** Filesystem function values can execute implicitly through conversions and callbacks. */
function fileReference(source: string, bindings: FsBindings, calls: NodeCall[], knownFs: boolean): boolean {
  const called = new Set(calls.map(call => call.index));
  let spanAt = 0;
  for (const match of source.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
    const name = match[1];
    if (!FILE_WRITER.test(name) && !FILE_PAIR.test(name) && !/^(?:readFile|open)(?:Sync)?$/.test(name)) continue;
    while (bindings.declarations[spanAt]?.end <= match.index!) spanAt++;
    const span = bindings.declarations[spanAt];
    if (called.has(match.index!) || span && span.start <= match.index! && match.index! < span.end) continue;
    let before = match.index!;
    while (before > 0 && /\s/.test(source[before - 1])) before--;
    if (knownFs && source[before - 1] === '.' || bindings.functions.has(name)) return true;
  }
  return false;
}

function inlineCalls(code: string, mutations: InlineMutations, bindings: FsBindings): NodeCall[] {
  const calls: NodeCall[] = [];
  for (const match of mutations.source.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    const receiver = nodeCallPrefix(mutations.source, match.index!);
    const prefix = receiver.text;
    if (CONTROL.test(name) && prefix === '') continue;
    const file = filesystemReceiver(prefix, bindings.namespaces)
      || !/\.\s*$/.test(prefix) && bindings.functions.has(name);
    const standardRequire = name === 'require' && !/[.\w$]\s*$/.test(prefix)
      && new RegExp(String.raw`^\s*${FS_MODULE}\s*\)`).test(mutations.source.slice(match.index! + match[0].length));
    const understood = unchangedInlineCall(name, prefix, mutations)
      && (file && (FILE_WRITER.test(name) || FILE_PAIR.test(name)
        || FS_READER.test(name) || /^open(?:Sync)?$/.test(name))
        || standardRequire || standardDataCall(name, prefix, mutations));
    calls.push({ name, index: match.index!, after: match.index! + match[0].length,
      understood, file, module: standardRequire, receiverAt: receiver.start });
  }
  return calls;
}

/** Unknown executable calls invalidate data exemptions; unresolved supported effects are explicit refusals. */
function analyzeNodeCalls(code: string): NodeCallContext {
  const mutations = inlineMutations(code);
  const bindings = fsBindings(mutations.source, mutations);
  const calls = inlineCalls(code, mutations, bindings);
  const knownFs = new RegExp(FS_REQUIRE).test(code)
    || new RegExp(String.raw`\bimport\s+[\s\S]*?\s+from\s+${FS_MODULE}`).test(code);
  const indirectFile = fileReference(mutations.source, bindings, calls, knownFs)
    || namespaceEscape(mutations.source, bindings, calls);
  const unclassifiedSyntax = knownFs && /[/\\]/.test(mutations.source.replace(new RegExp(FS_MODULE, 'g'), ''));
  const opaque = mutations.unknown || calls.some(call => !call.understood) || /[)\]]\s*\(/.test(mutations.source)
    || indirectFile || bindings.unsupported || unclassifiedSyntax;
  const unprovenWriter = calls.some(call => !call.understood
    && (FILE_WRITER.test(call.name) || FILE_PAIR.test(call.name)));
  let problem: string | undefined;
  if (indirectFile || bindings.unsupported || knownFs && opaque || unprovenWriter) {
    problem = 'Cannot statically resolve indirect or unclassified inline filesystem effects.';
  }
  if (mutations.unknown && mutations.literals.some(literal =>
    code[literal.index] === '`' && /\$\{/.test(literal.value))) {
    problem = 'Cannot statically resolve executable inline JavaScript interpolation.';
  }
  return { mutations, calls, callsByIndex: new Map(calls.map(call => [call.index, call])), opaque,
    ...fileEffects(code, calls, mutations, opaque, problem) };
}

let lastContext: { code: string; context: NodeCallContext } | undefined;

/** One pure lexical result is reused across policy consumers; no paths, approvals or filesystem state are cached. */
export function nodeCallContext(code: string): NodeCallContext {
  if (lastContext?.code === code) return lastContext.context;
  const context = analyzeNodeCalls(code);
  lastContext = { code, context };
  return context;
}

function fileEffects(
  code: string, calls: NodeCall[], mutations: InlineMutations, opaque: boolean, problem: string | undefined,
): Pick<NodeCallContext, 'problem' | 'targets'> {
  const targets: string[] = [];
  for (const call of calls) {
    problem ??= callbackProblem(code, call, mutations);
    if (!FILE_WRITER.test(call.name) && !FILE_PAIR.test(call.name) && !/^(?:readFile|open)(?:Sync)?$/.test(call.name)) continue;
    const firstEnd = nodeArgumentEnd(mutations.source, call.after);
    const tail = firstEnd === undefined ? '' : code.slice(firstEnd);
    const readFile = /^readFile(?:Sync)?$/.test(call.name)
      && readOnlyFileOpening(tail, mutations.intrinsicUndefined, !mutations.propertyWrites);
    const readOpen = /^open(?:Sync)?$/.test(call.name)
      && /^\s*(?:\)|,\s*(['"])r[sbt]?\1(?=\s*[,)]))/.test(tail);
    const writing = FILE_WRITER.test(call.name) || FILE_PAIR.test(call.name)
      || /^readFile(?:Sync)?$/.test(call.name) && (!readFile || opaque)
      || /^open(?:Sync)?$/.test(call.name) && (!readOpen || opaque);
    if (!writing) continue;
    const files = fileArguments(code, call, mutations);
    if (!files) problem ??= 'Cannot statically resolve the destination of an inline file operation.';
    else targets.push(...files);
  }
  return { problem, targets };
}
