import { parse, stringify } from 'yaml';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';
/** Reads a YAML file into a plain object; `undefined` when the file is absent. */
export function readYamlObject(file) {
    const text = readText(file);
    if (text === undefined)
        return undefined;
    let parsed;
    try {
        parsed = parse(text);
    }
    catch (error) {
        throw new SdlcError('invalid_yaml', { key: 'error.x_is_not_valid_yaml_x', params: { file: file, p2: error instanceof Error ? error.message : String(error) } }, { key: 'fix.fix_the_yaml_syntax_in_x', params: { file: file } });
    }
    if (parsed === null || parsed === undefined)
        return {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SdlcError('invalid_yaml', { key: 'error.x_must_contain_a_yaml_mapping', params: { file: file } });
    }
    return parsed;
}
export function writeYaml(file, value, header) {
    const body = stringify(value, { lineWidth: 0 });
    writeTextAtomic(file, header ? `${header.trimEnd()}\n${body}` : body);
}
