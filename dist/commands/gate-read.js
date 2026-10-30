import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { APPROVAL_GATES } from '../core/config.js';
import { readGate } from '../core/gate-read.js';
import { parseGate } from './gates.js';
export function gateReadCommand(gateArg, opts) {
    try {
        const ctx = loadProject();
        const gate = parseGate(gateArg, APPROVAL_GATES);
        const ref = resolveChange(ctx.paths, opts.change);
        const result = readGate(ctx.root, ref, ctx.config, gate);
        if (opts.json)
            return printJson(result);
        line(`${result.change}: ${gate} (${result.status})`);
        if (!result.snapshot)
            return;
        line(result.snapshot.digest);
        for (const file of result.snapshot.files) {
            line(`\n${file.path}\n${file.text}`);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
