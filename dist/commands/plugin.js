import * as fs from 'node:fs';
import { t } from '../core/i18n.js';
import * as path from 'node:path';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { isDirectory, listFilesRecursive, readText, writeTextAtomic } from '../core/fs-utils.js';
import { PLUGIN_NAME, renderClaudePlugin, renderMarketplace } from '../integrations/plugin.js';
export async function pluginBuildCommand(target, opts) {
    try {
        const dir = path.resolve(target ?? 'plugin');
        const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
        if (isDirectory(dir) && fs.readdirSync(dir).length > 0 && !opts.force) {
            let ours = false;
            try {
                ours = JSON.parse(readText(manifest) ?? '{}').name === PLUGIN_NAME;
            }
            catch {
                ours = false;
            }
            if (!ours)
                throw new SdlcError('plugin_dir_not_empty', { key: 'error.x_is_not_empty_and_is_not_an_sdlc_plugin', params: { dir: dir } }, { key: 'fix.choose_another_directory_or_pass_force' });
        }
        const files = renderClaudePlugin(opts.cli ?? 'sdlc');
        const wanted = new Set(files.map((f) => f.path));
        if (isDirectory(dir)) {
            for (const rel of listFilesRecursive(dir)) {
                if (!wanted.has(rel))
                    fs.rmSync(path.join(dir, rel), { force: true });
            }
        }
        for (const f of files)
            writeTextAtomic(path.join(dir, f.path), f.content);
        let marketplace;
        if (opts.marketplace) {
            marketplace = path.join(path.dirname(dir), '.claude-plugin', 'marketplace.json');
            writeTextAtomic(marketplace, renderMarketplace());
        }
        if (opts.json)
            return printJson({ dir, files: files.map((f) => f.path), ...(marketplace ? { marketplace } : {}) });
        line(`${c.green('✓')} ${t('plugin.written', { name: PLUGIN_NAME, dir, count: files.length })}`);
        if (marketplace)
            line(t('plugin.marketplace', { path: marketplace }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
