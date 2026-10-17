import * as path from 'node:path';
import { readText } from './fs-utils.js';
import { harnessPackageDir } from './openspec-schema.js';
let cached;
/** Version of the installed sdlc package (from its package.json). */
export function harnessVersion() {
    if (cached)
        return cached;
    try {
        const pkg = JSON.parse(readText(path.join(harnessPackageDir(), 'package.json')) ?? '{}');
        cached = pkg.version ?? '0.0.0';
    }
    catch {
        cached = '0.0.0';
    }
    return cached;
}
