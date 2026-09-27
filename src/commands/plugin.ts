import * as fs from 'node:fs';
import * as path from 'node:path';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { isDirectory, listFilesRecursive, readText, writeTextAtomic } from '../core/fs-utils.js';
import { PLUGIN_NAME, renderClaudePlugin, renderMarketplace } from '../integrations/plugin.js';

export async function pluginBuildCommand(target: string | undefined, opts: { cli?: string; marketplace?: boolean; force?: boolean; json?: boolean }): Promise<void> {
  try {
    const dir = path.resolve(target ?? 'plugin');
    const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
    if (isDirectory(dir) && fs.readdirSync(dir).length > 0 && !opts.force) {
      let ours = false;
      try {
        ours = (JSON.parse(readText(manifest) ?? '{}') as { name?: string }).name === PLUGIN_NAME;
      } catch {
        ours = false;
      }
      if (!ours) throw new SdlcError('plugin_dir_not_empty', `${dir} is not empty and is not an sdlc plugin.`, 'Choose another directory or pass --force.');
    }
    const files = renderClaudePlugin(opts.cli ?? 'sdlc');
    const wanted = new Set(files.map((f) => f.path));
    if (isDirectory(dir)) {
      for (const rel of listFilesRecursive(dir)) {
        if (!wanted.has(rel)) fs.rmSync(path.join(dir, rel), { force: true });
      }
    }
    for (const f of files) writeTextAtomic(path.join(dir, f.path), f.content);
    let marketplace: string | undefined;
    if (opts.marketplace) {
      marketplace = path.join(path.dirname(dir), '.claude-plugin', 'marketplace.json');
      writeTextAtomic(marketplace, renderMarketplace());
    }
    if (opts.json) return printJson({ dir, files: files.map((f) => f.path), ...(marketplace ? { marketplace } : {}) });
    line(`${c.green('✓')} Claude Code plugin '${PLUGIN_NAME}' written to ${dir} (${files.length} files)`);
    if (marketplace) line(`  marketplace: ${marketplace}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
