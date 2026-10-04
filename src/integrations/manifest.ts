import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exists, normalizeNewlines, readText, writeTextAtomic } from '../core/fs-utils.js';
import type { GeneratedFile } from './types.js';

/**
 * Ownership record for generated files (`openspec/.sdlc/manifest.json`).
 *
 * A file is rewritten or removed only while its content still hashes to what
 * the harness last wrote. A person's edit (or a file of the same name the
 * harness never wrote) is left alone and reported, unless `--force`.
 */
export interface ManifestEntry {
  sha256: string;
  tool: string;
  kind: string;
}

export interface Manifest {
  version: 1;
  /** sdlc version that last wrote the generated files. */
  harness: string;
  /** License the project used sdlc under when the files were generated. */
  license?: string;
  files: Record<string, ManifestEntry>;
}

export const MANIFEST_PATH = 'openspec/.sdlc/manifest.json';

export function sha256(text: string): string {
  return createHash('sha256').update(normalizeNewlines(text)).digest('hex');
}

export function readManifest(root: string): Manifest {
  const text = readText(path.join(root, MANIFEST_PATH));
  if (!text) return { version: 1, harness: '0.0.0', files: {} };
  try {
    const parsed = JSON.parse(text) as Manifest;
    return {
      version: 1,
      harness: parsed.harness ?? '0.0.0',
      ...(typeof parsed.license === 'string' ? { license: parsed.license } : {}),
      files: parsed.files ?? {},
    };
  } catch {
    return { version: 1, harness: '0.0.0', files: {} };
  }
}

export function writeManifest(root: string, manifest: Manifest): void {
  const sorted: Record<string, ManifestEntry> = {};
  for (const key of Object.keys(manifest.files).sort()) sorted[key] = manifest.files[key];
  writeTextAtomic(path.join(root, MANIFEST_PATH), `${JSON.stringify({ ...manifest, files: sorted }, null, 2)}\n`);
}

export interface ApplyReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  kept: string[];
  removed: string[];
}

function pruneEmptyDirs(root: string, rel: string): void {
  let dir = path.dirname(path.join(root, rel));
  const stop = path.resolve(root);
  while (path.resolve(dir) !== stop && path.resolve(dir).startsWith(stop)) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Writes `files`, removes previously generated files that are no longer
 * wanted, and updates the manifest. `scope` limits removal to entries of the
 * given tools/kinds so installing one tool never deletes another's files.
 */
export function applyFiles(
  root: string,
  files: GeneratedFile[],
  options: {
    force?: boolean;
    dryRun?: boolean;
    version: string;
    license?: string;
    removeObsolete?: (entry: ManifestEntry, rel: string) => boolean;
  }
): ApplyReport {
  const manifest = readManifest(root);
  const report: ApplyReport = { created: [], updated: [], unchanged: [], kept: [], removed: [] };
  const wanted = new Set(files.map((f) => f.path));

  for (const file of files) {
    const abs = path.join(root, file.path);
    const current = readText(abs);
    const entry = manifest.files[file.path];
    const record = () => {
      manifest.files[file.path] = { sha256: sha256(file.content), tool: file.tool, kind: file.kind };
    };
    if (current === undefined) {
      if (!options.dryRun) {
        writeTextAtomic(abs, file.content);
        if (file.mode) fs.chmodSync(abs, file.mode);
      }
      record();
      report.created.push(file.path);
    } else if (normalizeNewlines(current) === normalizeNewlines(file.content)) {
      record();
      report.unchanged.push(file.path);
    } else if (options.force || (entry && entry.sha256 === sha256(current))) {
      if (!options.dryRun) writeTextAtomic(abs, file.content);
      record();
      report.updated.push(file.path);
    } else {
      report.kept.push(file.path);
    }
  }

  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (wanted.has(rel)) continue;
    if (options.removeObsolete && !options.removeObsolete(entry, rel)) continue;
    const abs = path.join(root, rel);
    const current = readText(abs);
    if (current !== undefined && sha256(current) !== entry.sha256 && !options.force) {
      report.kept.push(rel);
      delete manifest.files[rel];
      continue;
    }
    if (!options.dryRun && exists(abs)) {
      fs.rmSync(abs, { force: true });
      pruneEmptyDirs(root, rel);
    }
    delete manifest.files[rel];
    report.removed.push(rel);
  }

  manifest.harness = options.version;
  if (options.license) manifest.license = options.license;
  if (!options.dryRun) writeManifest(root, manifest);
  return report;
}
