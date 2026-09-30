import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { isWithin, toPosix } from './fs-utils.js';
import { CONVERT_EXCLUDES, detectLayout, layoutRole, PINNED_PATHS, type ConvertMove, type ConvertPlan } from './layout.js';

function run(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new SdlcError('git_error', (result.stderr ?? '').trim() || `git ${args[0]} failed`);
  return result.stdout ?? '';
}

function safe(root: string, rel: string): string {
  const absolute = path.resolve(root, rel);
  if (!isWithin(root, absolute)) throw new SdlcError('invalid_path', `Path outside project: ${rel}`);
  return absolute;
}

function excluded(rel: string): boolean {
  const lower = rel.toLowerCase();
  return CONVERT_EXCLUDES.some((p) => lower.startsWith(p.toLowerCase()));
}

function movedPath(rel: string, moves: ConvertMove[]): string {
  for (const move of moves) {
    if (move.from.endsWith('/')) {
      if (rel.toLowerCase().startsWith(move.from.toLowerCase())) return move.to + rel.slice(move.from.length);
    } else if (rel.toLowerCase() === move.from.toLowerCase()) return move.to;
  }
  return rel;
}

function rewriteTarget(target: string, file: string, moves: ConvertMove[], root: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) return target;
  const match = /^([^?#]*)([?#].*)?$/.exec(target);
  if (!match || !match[1]) return target;
  const oldFile = path.posix.normalize(file);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(oldFile), match[1]));
  if (!isWithin(root, path.resolve(root, resolved))) return target;
  const newFile = movedPath(file, moves);
  const newTarget = movedPath(resolved, moves);
  if (newFile === file && newTarget === resolved) return target;
  let relative = path.posix.relative(path.posix.dirname(newFile), newTarget);
  if (match[1].endsWith('/') && relative && !relative.endsWith('/')) relative += '/';
  if (!relative) relative = match[1].endsWith('/') ? './' : path.posix.basename(newTarget);
  return relative + (match[2] ?? '');
}

function rewrite(text: string, file: string, moves: ConvertMove[], root: string): { text: string; links: number } {
  let links = 0;
  let fence = false;
  const lines = text.split(/(?<=\n)/);
  const output = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    const parts = line.split(/(`+[^`]*`+)/g);
    return parts.map((part, index) => {
      if (index % 2) return part;
      const replace = (whole: string, prefix: string, target: string, suffix: string) => {
        const next = rewriteTarget(target, file, moves, root);
        if (next !== target) links++;
        return prefix + next + suffix;
      };
      return part.replace(/(\[[^\]]+\]\()([^\s)]+)(\))/g, replace)
        .replace(/(^\s*\[[^\]]+\]:\s*<?)([^\s>]+)(>?)/g, replace);
    }).join('');
  });
  return { text: output.join(''), links };
}

function markdownFiles(root: string): string[] {
  const raw = run(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return raw.split('\0').filter((rel) => rel && /\.md$/i.test(rel) && !excluded(rel) && fs.existsSync(safe(root, rel)));
}

export function planConversion(root: string, config: SdlcConfig): ConvertPlan {
  const plan: ConvertPlan = { moves: [], linkRewrites: [], skipped: [], conflicts: [] };
  const tracked = new Set(run(root, ['ls-files', '-z']).split('\0'));
  const report = detectLayout(root, config.layout);
  for (const found of report.roles) {
    const role = layoutRole(found.role);
    if (found.status === 'missing') continue;
    if (found.status === 'canonical') {
      for (const alias of found.candidates.filter((p) => p !== found.path))
        plan.skipped.push({ role: role.id, path: alias, reason: 'Canonical target exists.' });
      continue;
    }
    const from = found.path!;
    const to = role.path;
    safe(root, from);
    safe(root, to);
    if (excluded(from) || excluded(to)) {
      plan.skipped.push({ role: role.id, path: from, reason: 'Excluded tool data.' });
      continue;
    }
    if (PINNED_PATHS.some((p) => p.endsWith('/') ? from.toLowerCase().startsWith(p.toLowerCase()) : from.toLowerCase() === p.toLowerCase())) {
      plan.skipped.push({ role: role.id, path: from, reason: 'Pinned by tool convention.' });
      continue;
    }
    if (from.toLowerCase() === to.toLowerCase()) continue;
    const move = { role: role.id, from, to };
    if (fs.existsSync(safe(root, to))) plan.conflicts.push({ ...move, reason: 'Canonical target exists.' });
    else if (role.kind === 'dir' ? ![...tracked].some((p) => p.startsWith(from)) : !tracked.has(from))
      plan.conflicts.push({ ...move, reason: 'Source is not tracked by git.' });
    else plan.moves.push(move);
  }
  for (const file of markdownFiles(root)) {
    const links = rewrite(fs.readFileSync(safe(root, file), 'utf8'), file, plan.moves, root).links;
    if (links) plan.linkRewrites.push({ file: toPosix(file), links });
  }
  return plan;
}

export function applyConversion(root: string, config: SdlcConfig, plan: ConvertPlan): void {
  if (plan.conflicts.length) throw new SdlcError('conversion_conflict', 'Conversion plan has conflicts.');
  for (const move of plan.moves) {
    safe(root, move.from);
    safe(root, move.to);
  }
  for (const entry of plan.linkRewrites) safe(root, entry.file);
  if (run(root, ['status', '--porcelain', '--untracked-files=all']).trim())
    throw new SdlcError('dirty_worktree', 'The worktree must be clean before conversion.');
  for (const move of plan.moves) {
    fs.mkdirSync(path.dirname(safe(root, move.to)), { recursive: true });
    run(root, ['mv', '--', move.from.replace(/\/$/, ''), move.to.replace(/\/$/, '')]);
  }
  for (const entry of plan.linkRewrites) {
    const destination = movedPath(entry.file, plan.moves);
    const absolute = safe(root, destination);
    const original = fs.readFileSync(absolute, 'utf8');
    const updated = rewrite(original, entry.file, plan.moves, root).text;
    if (updated !== original) {
      fs.writeFileSync(absolute, updated, 'utf8');
      run(root, ['add', '--', destination]);
    }
  }
  for (const move of plan.moves) delete config.layout[move.role];
}
