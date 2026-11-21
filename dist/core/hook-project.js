import * as fs from 'node:fs';
import * as path from 'node:path';
/** Hook discovery follows actual SDLC configuration, independently of OpenSpec planning-directory discovery. */
export function findHookProjectRoot(start) {
    let current = path.resolve(start);
    for (;;) {
        try {
            fs.statSync(path.join(current, 'openspec/sdlc.yaml'));
            return current;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
