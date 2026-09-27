import { parse, stringify } from 'yaml';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';

/** Reads a YAML file into a plain object; `undefined` when the file is absent. */
export function readYamlObject(file: string): Record<string, unknown> | undefined {
  const text = readText(file);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new SdlcError(
      'invalid_yaml',
      `${file} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      `Fix the YAML syntax in ${file}.`
    );
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SdlcError('invalid_yaml', `${file} must contain a YAML mapping.`);
  }
  return parsed as Record<string, unknown>;
}

export function writeYaml(file: string, value: unknown, header?: string): void {
  const body = stringify(value, { lineWidth: 0 });
  writeTextAtomic(file, header ? `${header.trimEnd()}\n${body}` : body);
}
