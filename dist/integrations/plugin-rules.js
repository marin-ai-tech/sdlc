import { harnessStamp } from '../core/license.js';
import { codexAdapter, CODEX_RULES_PATH } from './codex.js';
import { renderContext } from './install.js';
import { applyFiles, readManifest } from './manifest.js';
import { secondLayerPlan } from './second-layer.js';
import { refreshQwenDeny } from './qwen-settings.js';
/** Trust has already committed. Failed refresh never rewrites user-edited files or rolls back that decision. */
export function refreshPluginRules(root, config) {
    const plan = secondLayerPlan(root, config);
    const report = { updated: [], kept: [], diagnostics: [...plan.diagnostics] };
    try {
        if (config.tools.includes('codex') && readManifest(root).files[CODEX_RULES_PATH]) {
            const stamp = harnessStamp(config);
            const rules = codexAdapter.render(renderContext(config, ['codex'], root))
                .filter(file => file.path === CODEX_RULES_PATH);
            const applied = applyFiles(root, rules, { version: stamp.version, license: stamp.license,
                removeObsolete: () => false });
            report.updated.push(...applied.created, ...applied.updated);
            report.kept.push(...applied.kept);
        }
        for (const id of ['qwen', 'gigacode']) {
            if (!config.tools.includes(id))
                continue;
            const result = refreshQwenDeny(root, config.cli, id, plan.commands);
            if (result === 'installed')
                report.updated.push(`.${id}/settings.json`);
        }
    }
    catch {
        report.diagnostics.push({ code: 'plugin_rules_pending',
            message: 'Trust changed; owned command rules could not be refreshed. Inspect integrations and run update.' });
    }
    return report;
}
