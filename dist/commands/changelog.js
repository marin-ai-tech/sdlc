import { loadProject } from '../cli/context.js';
import { printJson, reportFailure } from '../cli/output.js';
import { buildChangelog, changelogMarkdown, changelogRefs } from '../core/changelog.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';
import { parseSince } from '../report/model.js';
function sinceDate(since) {
    const iso = parseSince(since);
    return iso === undefined ? undefined : iso.slice(0, 10);
}
/** `sdlc changelog [--change <id> | --since <date>] [--json]` (B22): anyone may run it; writes nothing. */
export function changelogCommand(opts) {
    try {
        if (opts.change !== undefined && opts.since !== undefined) {
            throw new SdlcError('invalid_option', { key: 'error.changelog_change_or_since' });
        }
        const ctx = loadProject();
        const refs = changelogRefs(ctx.paths, { change: opts.change, sinceDate: sinceDate(opts.since) });
        const log = buildChangelog(refs);
        if (opts.json) {
            printJson(log);
            return;
        }
        process.stdout.write(changelogMarkdown(log, t('changelog.none')));
    }
    catch (error) {
        reportFailure(error, opts.json, { added: null, changed: null, removed: null });
    }
}
