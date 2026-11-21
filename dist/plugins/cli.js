import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { loadConfig } from '../core/config.js';
import { findProjectRoot } from '../core/project.js';
import { fail, parsePluginInput, pluginError } from './api.js';
import { callPlugin, cliActor } from './broker.js';
import { pluginCommands } from './catalog.js';
export async function pluginCommand(name, command, opts) {
    try {
        const ctx = loadProject();
        const route = pluginCommands(ctx.root, ctx.config).find((item) => item.name === `${name} ${command}`);
        if (!route)
            fail('plugin_operation', 'Plugin command is not currently available');
        let raw;
        try {
            raw = JSON.parse(opts.inputJson ?? '{}');
        }
        catch {
            fail('plugin_invalid', 'Input must be valid JSON');
        }
        const result = await callPlugin(ctx.root, ctx.config, name, route.operation, parsePluginInput(raw), cliActor(ctx.root, opts.executor), opts.request);
        if (opts.json)
            printJson(result);
        else
            line(JSON.stringify(result, null, 2));
    }
    catch (error) {
        reportFailure(pluginError(error), opts.json);
    }
}
/** Register configured roots too, so broken trust produces its own diagnostic on a direct invocation. */
export function registerPluginCommands(program, root = findProjectRoot()) {
    if (!root)
        return;
    let config;
    try {
        config = loadConfig(`${root}/openspec/sdlc.yaml`);
    }
    catch {
        return;
    }
    for (const name of Object.keys(config.plugins ?? {})) {
        if (program.commands.some((command) => command.name() === name || command.aliases().includes(name))) {
            fail('plugin_name', 'Plugin namespace collides with a core command');
        }
        const namespace = program.command(name).description(`Runtime plugin ${name}`);
        let routes;
        try {
            routes = pluginCommands(root, { ...config, plugins: { [name]: config.plugins[name] } });
        }
        catch {
            namespace.argument('[command]').allowUnknownOption().allowExcessArguments()
                .action((command, opts) => {
                return pluginCommand(name, command, { ...opts, json: process.argv.includes('--json') });
            });
            continue;
        }
        for (const route of routes) {
            const command = namespace.command(route.name.split(' ')[1])
                .description(`Plugin ${name}: ${route.operation} (${route.access})`)
                .option('--input-json <json>', 'schema-validated JSON input', '{}')
                .option('--request <id>', 'stable mutating request identifier')
                .option('--executor <id>', 'registered executor identity')
                .option('--json', 'output JSON')
                .action((opts) => pluginCommand(name, route.name.split(' ')[1], opts));
            command.pluginAccess = route.access;
        }
    }
}
