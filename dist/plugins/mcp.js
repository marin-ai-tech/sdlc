import { loadConfig } from '../core/config.js';
import { errorResult } from '../mcp/call-tool.js';
import { fail, keys, object, parsePluginInput, pluginDiagnostic } from './api.js';
import { callPlugin } from './broker.js';
import { compatibleDescriptor, pluginTools } from './catalog.js';
function currentTools(project) {
    return pluginTools(project.root, loadConfig(`${project.root}/openspec/sdlc.yaml`));
}
function catalog(projects) {
    const tools = new Map();
    const projectsWithTools = new Map();
    const diagnostics = [];
    for (const project of projects) {
        let current;
        try {
            current = currentTools(project);
        }
        catch (error) {
            const { code, message } = pluginDiagnostic(error);
            diagnostics.push({ code, message });
            continue;
        }
        projectsWithTools.set(project.name, current);
        for (const descriptor of current) {
            const previous = tools.get(descriptor.name);
            if (previous === null)
                continue;
            tools.set(descriptor.name, previous && !compatibleDescriptor(previous, descriptor) ? null : descriptor);
        }
    }
    for (const [tool, descriptor] of tools) {
        if (descriptor === null)
            diagnostics.push({ code: 'plugin_tool_conflict', tool,
                message: 'Served projects have incompatible descriptors for this plugin tool.' });
    }
    return { tools, projectsWithTools, diagnostics };
}
function permitted(descriptor, project, caller) {
    return descriptor.access === 'read' || (descriptor.access === 'executor'
        && !!caller.executor && caller.project === project.name);
}
function inputSchema(descriptor, several) {
    const nest = (value) => {
        if (Array.isArray(value))
            return value.map(nest);
        if (!value || typeof value !== 'object')
            return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
            key === '$ref' && typeof item === 'string' && item.startsWith('#')
                ? `#/properties/input${item.slice(1)}` : nest(item)]));
    };
    const properties = { input: nest(descriptor.inputSchema) };
    const required = ['input'];
    if (descriptor.access !== 'read') {
        properties.request = { type: 'string', description: 'Stable p1.<unix-ms>.<32hex> request identifier' };
        required.push('request');
    }
    if (several)
        properties.project = { type: 'string', description: 'Served project name' };
    return { type: 'object', properties, required, additionalProperties: false };
}
/** Current accepted descriptors only; neither discovery nor dispatch keeps a trusted session cache. */
export function pluginToolDiscovery(projects, caller = {}) {
    const { tools, projectsWithTools, diagnostics } = catalog(projects);
    const result = [];
    for (const descriptor of tools.values()) {
        if (!descriptor || descriptor.access === 'person')
            continue;
        const allowed = projects.some((project) => {
            if (!permitted(descriptor, project, caller))
                return false;
            return projectsWithTools.get(project.name)?.some((item) => compatibleDescriptor(item, descriptor)) ?? false;
        });
        if (allowed)
            result.push({ name: descriptor.name,
                description: `Plugin ${descriptor.plugin}: ${descriptor.operation} (${descriptor.access})`,
                inputSchema: inputSchema(descriptor, projects.length > 1) });
    }
    return { tools: result, diagnostics };
}
export function listedPluginTools(projects, caller = {}) {
    return pluginToolDiscovery(projects, caller).tools;
}
function targetProject(args, projects, caller) {
    if (args.project !== undefined && (typeof args.project !== 'string' || !args.project.trim())) {
        fail('invalid_arguments', 'Project must be a served project name');
    }
    const name = args.project ?? caller.project ?? (projects.length === 1 ? projects[0].name : undefined);
    if (name === undefined)
        fail('project_required', 'A project is required for plugin tools');
    if (caller.project && name !== caller.project)
        fail('plugin_executor', 'Executor token belongs to another project');
    const project = projects.find((item) => item.name === name);
    if (!project)
        fail('unknown_project', 'Project is not served');
    return project;
}
export async function callPluginTool(name, input, projects, caller = {}) {
    try {
        const args = object(input, 'plugin tool arguments');
        keys(args, ['input', 'project', 'request'], 'plugin tool arguments');
        if (!Object.hasOwn(args, 'input'))
            fail('invalid_arguments', 'Plugin input is required');
        const project = targetProject(args, projects, caller);
        const shared = catalog(projects).tools.get(name);
        if (shared === null)
            fail('plugin_tool_conflict', 'Served projects have incompatible plugin descriptors');
        const config = loadConfig(`${project.root}/openspec/sdlc.yaml`);
        const descriptor = pluginTools(project.root, config).find((item) => item.name === name);
        if (!descriptor)
            fail('unknown_tool', 'Plugin tool is not currently available');
        if (!permitted(descriptor, project, caller))
            fail('plugin_access', 'Plugin tool is not permitted for this caller');
        if (descriptor.access === 'read' && args.request !== undefined)
            fail('invalid_arguments', 'Read tools do not take request');
        if (args.request !== undefined && typeof args.request !== 'string')
            fail('invalid_arguments', 'Request must be a string');
        const result = await callPlugin(project.root, config, descriptor.plugin, descriptor.operation, parsePluginInput(args.input), { origin: 'mcp', ...(caller.executor ? { executor: caller.executor } : {}) }, args.request);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
    catch (error) {
        const diagnostic = pluginDiagnostic(error);
        return errorResult(diagnostic.code, diagnostic.message);
    }
}
