import { line, printJson, reportFailure } from '../cli/output.js';
import { guideArticle, guideIndex } from '../core/guide.js';
import { guideTour } from '../core/guide-tour.js';
import { agentEnvironment } from '../core/agent-env.js';
import { currentLocale, t } from '../core/i18n.js';
import { markdownToTerminal, terminalWidth } from '../core/md-terminal.js';
function guideText(body, opts) {
    return opts.markdown || agentEnvironment() ? body.trimEnd() : markdownToTerminal(body, terminalWidth());
}
function printIndex(topics, opts) {
    line(t('guide.index'));
    const width = Math.max(...topics.map((topic) => topic.id.length), 0);
    for (const topic of topics) {
        line(`  ${topic.id.padEnd(width)}  ${topic.title} - ${topic.summary}`);
    }
    line(`\n${guideText(t('guide.more'), opts)}`);
    line(guideText(t('guide.tourHint'), opts));
}
function printTour(tour, opts) {
    const { n, title, body } = tour.current;
    line(t('guide.tourStep', { n, count: tour.steps.length, title }));
    line('');
    line(guideText(body, opts));
    line('');
    const message = n < tour.steps.length
        ? t('guide.tourNext', { next: n + 1, title: tour.steps[n].title })
        : t('guide.tourEnd');
    line(guideText(message, opts));
}
/** `sdlc guide tour [step] [--json]` (B52): the tour index and one step. */
function tourCommand(step, opts) {
    const tour = guideTour(currentLocale(), step);
    if (opts.json)
        printJson({ tour });
    else
        printTour(tour, opts);
}
/** `sdlc guide [topic] [step] [--json]`: any actor, inside or outside a project. */
export function guideCommand(topic, step, opts) {
    try {
        if (topic === 'tour')
            return tourCommand(step, opts);
        const locale = currentLocale();
        if (topic === undefined) {
            const index = guideIndex(locale);
            if (opts.json)
                printJson(index);
            else
                printIndex(index.topics, opts);
            return;
        }
        const article = guideArticle(topic, locale);
        if (opts.json)
            printJson(article);
        else
            line(guideText(article.body, opts));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
