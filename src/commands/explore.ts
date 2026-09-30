import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { isWithin, readText } from '../core/fs-utils.js';
import { appendLog } from '../core/log.js';
import { readAsset } from '../integrations/assets.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function exploreCommand(slug: string, opts: { json?: boolean }): void {
  try {
    if (!slugPattern.test(slug)) throw new SdlcError('invalid_option', 'Exploration slug must be kebab-case.');
    const ctx = loadProject();
    const directory = path.join(ctx.paths.openspecDir, 'explorations');
    const target = path.join(directory, `${slug}.md`);
    if (!isWithin(directory, target)) throw new SdlcError('invalid_option', 'Exploration path is outside explorations.');
    const relativePath = `openspec/explorations/${slug}.md`;
    const template = readAsset('records', 'exploration.md').replaceAll('<slug>', slug);
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(target, template, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SdlcError('exploration_exists', `Exploration already exists: ${relativePath}`);
      throw error;
    }
    appendLog(ctx.root, ctx.config, { event: 'exploration.created', detail: relativePath }, ctx.stamp);
    if (opts.json) printJson({ slug, path: relativePath });
    else line(`Created exploration ${relativePath}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function exploreListCommand(opts: { json?: boolean }): void {
  try {
    const ctx = loadProject();
    const directory = path.join(ctx.paths.openspecDir, 'explorations');
    const explorations = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && slugPattern.test(entry.name.slice(0, -3)))
      .map((entry) => {
        const slug = entry.name.slice(0, -3);
        const title = readText(path.join(directory, entry.name))?.match(/^# (.+)$/m)?.[1];
        return { slug, path: `openspec/explorations/${entry.name}`, ...(title ? { title } : {}) };
      }).sort((a, b) => a.slug.localeCompare(b.slug)) : [];
    if (opts.json) printJson({ explorations });
    else for (const item of explorations) line(`${item.slug}  ${item.path}`);
  } catch (error) {
    reportFailure(error, opts.json, { explorations: [] });
  }
}
