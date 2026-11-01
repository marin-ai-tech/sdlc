import type { SdlcConfig } from '../core/config.js';
import { capturePackage } from './package.js';
import { activePlugin, readRegistry, type ActivePlugin } from './trust.js';
import { readStored } from './activation.js';
import { LIMITS, canonical, fail, pluginDiagnostic, type Operation, type Schema } from './api.js';
import type { PackageSnapshot } from './api.js';
import { normalizeSchema } from './schema-anchors.js';

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
  return normalizeSchema(snapshot.files, schema);
}

function descriptors(root: string, config: SdlcConfig, kind: 'commands' | 'tools'): PluginDescriptor[] {
  let bytes = 0;
  return activePlugins(root, config).flatMap(({ snapshot }) => {
    const schemas = new Map<Schema, { value: unknown; bytes: number }>();
    const read = (schema: Schema) => {
      if (!schemas.has(schema)) {
        const value = publicSchema(snapshot, schema);
        schemas.set(schema, { value, bytes: Buffer.byteLength(JSON.stringify(value)) });
      }
      return schemas.get(schema)!;
    };
    return Object.entries(snapshot.manifest[kind]).map(([segment, operation]) => {
      const declared = snapshot.manifest.operations[operation];
      const input = read(declared.input);
      const output = read(declared.output);
      bytes += input.bytes + output.bytes;
      if (bytes > LIMITS.packageBytes) fail('plugin_schema', 'Public schema catalog byte limit exceeded');
      return { plugin: snapshot.manifest.name,
        name: kind === 'tools' ? `${snapshot.manifest.name}__${segment}` : `${snapshot.manifest.name} ${segment}`,
        operation, access: declared.access, inputSchema: input.value, outputSchema: output.value };
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
  return canonical(left, LIMITS.packageBytes, 72) === canonical(right, LIMITS.packageBytes, 72);
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
