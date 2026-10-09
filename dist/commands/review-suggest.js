import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { defaultBaseRef } from '../core/git.js';
import { t } from '../core/i18n.js';
import { computePlanDrift } from '../core/plan-drift.js';
import { requireRoles, suggestReviewers } from '../core/review-suggest.js';
import { readManifest } from '../integrations/manifest.js';
/** One line per candidate, the suggestion first. */
function printSuggestion(result, total) {
    if (result.candidates.length === 0) {
        line(t('review.suggestNone', { change: result.change }));
        return;
    }
    for (const [index, candidate] of result.candidates.entries()) {
        const params = { name: candidate.name, person: candidate.person, owns: candidate.owns.length, total,
            open: candidate.openReviews };
        line(t(index === 0 ? 'review.suggestFirst' : 'review.suggestOther', params));
    }
}
/** `sdlc review suggest`: read-only, so any actor may run it; it records nothing. */
export function reviewSuggest(opts) {
    try {
        const ctx = loadProject();
        const roles = requireRoles(ctx.root);
        const ref = resolveChange(ctx.paths, opts.change);
        const base = opts.base ?? ctx.config.review.base ?? defaultBaseRef(ctx.root);
        const ignore = Object.keys(readManifest(ctx.root).files);
        const files = computePlanDrift(ctx.root, ref.dir, base, ignore).changedFiles;
        const result = suggestReviewers(ctx, roles, ref, base, files);
        if (opts.json) {
            printJson(result);
            return;
        }
        printSuggestion(result, files.length);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
