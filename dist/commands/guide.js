import { line, printJson, reportFailure } from '../cli/output.js';
import { guideArticle, guideIndex } from '../core/guide.js';
import { guideTour } from '../core/guide-tour.js';
import { currentLocale, t } from '../core/i18n.js';
function printIndex(topics) {
    line(t('guide.index'));
    const width = Math.max(...topics.map((topic) => topic.id.length), 0);
    for (const topic of topics) {
        line(`  ${topic.id.padEnd(width)}  ${topic.title} - ${topic.summary}`);
    }
    line(`\n${t('guide.more')}`);
    line(t('guide.tourHint'));
}
function printTour(tour) {
    const { n, title, body } = tour.current;
    line(t('guide.tourStep', { n, count: tour.steps.length, title }));
    line('');
    line(body.trimEnd());
    line('');
    if (n < tour.steps.length)
        line(t('guide.tourNext', { next: n + 1, title: tour.steps[n].title }));
    else
        line(t('guide.tourEnd'));
}
/** `sdlc guide tour [step] [--json]` (B52): the tour index and one step. */
function tourCommand(step, opts) {
    const tour = guideTour(currentLocale(), step);
    if (opts.json)
        printJson({ tour });
    else
        printTour(tour);
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
                printIndex(index.topics);
            return;
        }
        const article = guideArticle(topic, locale);
        if (opts.json)
            printJson(article);
        else
            line(article.body.trimEnd());
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
