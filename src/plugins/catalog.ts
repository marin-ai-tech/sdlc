import type { SdlcConfig } from '../core/config.js';
import { capturePackage } from './package.js';
import { activePlugin, readRegistry, type ActivePlugin } from './trust.js';
import { readStored } from './activation.js';
import { canonical, fail, pluginDiagnostic, type Operation, type Schema } from './api.js';
import type { PackageSnapshot } from './api.js';

export interface PluginDescriptor {
  plugin: string;
  name: string;
  operation: string;
  access: Operation['access'];
  inputSchema: unknown;
  outputSchema: unknown;
}

/** Package-local schemas become self-contained public descriptors without reopening source files. */
function publicSchema(snapshot: PackageSnapshot, schema: Schema): unknown {
  const definitions: Record<string, unknown> = Object.create(null);
  const pointer = (file: string) => file.replaceAll('~', '~0').replaceAll('/', '~1');
  const root = typeof schema === 'string' ? { $ref: schema } : schema;
  const documents = new Map<string, unknown>([['', root]]);
  const anchor = (value: unknown, name: string, at = ''): string | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if ((value as Record<string, unknown>).$anchor === name) return at;
    for (const [key, item] of Object.entries(value)) {
      const found = anchor(item, name, `${at}/${pointer(key)}`);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const visit = (value: unknown, base = ''): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item, base));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '$id' || key === '$anchor') continue;
      if (key !== '$ref' || typeof item !== 'string') {
        result[key] = visit(item, base);
        continue;
      }
      const [relative, fragment = ''] = item.split('#');
      const directory = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
      const file = relative ? `${directory}${relative}` : base;
      if (!Object.hasOwn(definitions, file)) {
        if (!documents.has(file)) {
          const bytes = snapshot.files.get(file);
          if (!bytes) fail('plugin_schema', 'Missing captured schema document');
          try { documents.set(file, JSON.parse(bytes.toString('utf8'))); }
          catch { fail('plugin_schema', 'Invalid captured schema document'); }
        }
        definitions[file] = true;
        definitions[file] = visit(documents.get(file), file);
      }
      const suffix = !fragment || fragment.startsWith('/') ? fragment : anchor(documents.get(file), fragment);
      if (suffix === undefined) fail('plugin_schema', 'Missing captured schema anchor');
      result[key] = `#/$defs/${pointer(file)}${suffix}`;
    }
    return result;
  };
  definitions[''] = true;
  definitions[''] = visit(root);
  return { $ref: '#/$defs/', $defs: definitions };
}

function descriptors(root: string, config: SdlcConfig, kind: 'commands' | 'tools'): PluginDescriptor[] {
  return activePlugins(root, config).flatMap(({ snapshot }) => {
    return Object.entries(snapshot.manifest[kind]).map(([segment, operation]) => {
      const declared = snapshot.manifest.operations[operation];
      return { plugin: snapshot.manifest.name,
        name: kind === 'tools' ? `${snapshot.manifest.name}__${segment}` : `${snapshot.manifest.name} ${segment}`,
        operation, access: declared.access, inputSchema: publicSchema(snapshot, declared.input),
        outputSchema: publicSchema(snapshot, declared.output) };
    });
  });
}

export function pluginCommands(root: string, config: SdlcConfig): PluginDescriptor[] {
  return descriptors(root, config, 'commands');
}

export function pluginTools(root: string, config: SdlcConfig): PluginDescriptor[] {
  return descriptors(root, config, 'tools');
}

export function pluginHumanCommands(root: string, config: SdlcConfig): string[] {
  return pluginCommands(root, config).filter((item) => item.access === 'person').map((item) => item.name);
}

export function compatibleDescriptor(left: PluginDescriptor, right: PluginDescriptor): boolean {
  return canonical(left) === canonical(right);
}

export function activePlugins(root: string, config: SdlcConfig): ActivePlugin[] {
  return Object.entries(config.plugins ?? {}).filter(([, setting]) => setting.enabled)
    .map(([name]) => activePlugin(root, config, name));
}

export function pluginReports(root: string, config: SdlcConfig) {
  return Object.entries(config.plugins ?? {}).map(([name, setting]) => {
    try {
      const snapshot = capturePackage(root, setting.package);
      const accepted = readRegistry(root).plugins[name];
      const problems = [];
      if (snapshot.manifest.name !== name) problems.push({ code: 'plugin_name', message: 'Namespace mismatch' });
      if (setting.digest !== snapshot.digest) problems.push({ code: 'plugin_changed', message: 'Package pin differs' });
      if (setting.enabled) {
        try { activePlugin(root, config, name); } catch (error) { problems.push(pluginDiagnostic(error)); }
        for (const lock of ['activation.lock', 'recovery.lock', `state/${name}/store.lock`]) {
          if (readStored(root, lock) !== undefined) problems.push({ code: 'plugin_busy',
            message: `${lock}: writer/recovery record present; live owners are never displaced by age` });
        }
      }
      return { name, enabled: setting.enabled, version: snapshot.manifest.version, digest: snapshot.digest,
        configuredDigest: setting.digest, accepted: accepted?.status === 'accepted', active: setting.enabled && !problems.length,
        manifest: snapshot.manifest, problems };
    } catch (error) {
      return { name, enabled: setting.enabled, active: false, accepted: false, problems: [pluginDiagnostic(error)] };
    }
  });
}
