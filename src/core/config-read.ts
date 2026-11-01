import * as fs from 'node:fs';
import { parse } from 'yaml';
import { SdlcError } from './errors.js';

/** Only an absent file uses defaults. Permission, shape and I/O errors remain operational failures. */
export function readConfigObject(file: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw new SdlcError('config_read', `Cannot read configuration ${file}: ${code ?? 'I/O error'}.`,
      'A person must restore configuration read access and run sdlc doctor.');
  }
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    throw new SdlcError('invalid_yaml',
      { key: 'error.x_is_not_valid_yaml_x', params: { file, p2: String(error) } },
      { key: 'fix.fix_the_yaml_syntax_in_x', params: { file } });
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SdlcError('invalid_yaml', { key: 'error.x_must_contain_a_yaml_mapping', params: { file } });
  }
  return value as Record<string, unknown>;
}
