import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { pluginReports } from '../plugins/catalog.js';
import { acceptPlugin, configured, revokePlugin } from '../plugins/trust.js';
import { invoke } from '../plugins/runtime.js';
import { recoverPlugin } from '../plugins/recovery.js';
import { fail, pluginError } from '../plugins/api.js';
import { projectEvents } from '../plugins/events.js';
import { readRegistry } from '../plugins/trust.js';

export async function pluginsCommand(action: string, name: string | undefined,
  opts: { json?: boolean; expectDigest?: string; request?: string }): Promise<void> {
  try {
    const ctx = loadProject();
    let result: unknown;
    if (action === 'list') result = { plugins: pluginReports(ctx.root, ctx.config) };
    else {
      if (!name) fail('usage', 'Plugin name is required');
      if (action === 'accept') result = await acceptPlugin(ctx.root, ctx.config, name, opts.expectDigest ?? '');
      else if (action === 'revoke') result = revokePlugin(ctx.root, name);
      else if (action === 'recover') {
        const recovery = recoverPlugin(ctx.root, name, opts.request);
        result = { ...recovery, projection: projectEvents(ctx.root, ctx.config, name, readRegistry(ctx.root).plugins[name].stateId) };
      }
      else if (action === 'inspect') {
        const report = pluginReports(ctx.root, ctx.config).find((r) => r.name === name);
        if (!report) fail('plugin_unknown', 'Plugin is not configured');
        if (report.problems.length === 0 || report.problems.every((p) => p.code === 'plugin_unaccepted')) {
          const { snapshot, setting } = configured(ctx.root, ctx.config, name);
          await invoke(snapshot, { preflight: true, validate: { kind: 'config', value: setting.config } });
        }
        result = report;
      } else fail('usage', 'Unknown plugin management action');
    }
    if (opts.json) printJson(result);
    else line(JSON.stringify(result, null, 2));
  } catch (error) { reportFailure(pluginError(error), opts.json); }
}
