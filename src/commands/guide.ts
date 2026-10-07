import { line, printJson, reportFailure } from '../cli/output.js';
import { guideArticle, guideIndex, type GuideTopic } from '../core/guide.js';
import { currentLocale, t } from '../core/i18n.js';

function printIndex(topics: GuideTopic[]): void {
  line(t('guide.index'));
  const width = Math.max(...topics.map((topic) => topic.id.length), 0);
  for (const topic of topics) {
    line(`  ${topic.id.padEnd(width)}  ${topic.title} - ${topic.summary}`);
  }
  line(`\n${t('guide.more')}`);
}

/** `sdlc guide [topic] [--json]`: any actor, inside or outside a project. */
export function guideCommand(topic: string | undefined, opts: { json?: boolean }): void {
  try {
    const locale = currentLocale();
    if (topic === undefined) {
      const index = guideIndex(locale);
      if (opts.json) printJson(index);
      else printIndex(index.topics);
      return;
    }
    const article = guideArticle(topic, locale);
    if (opts.json) printJson(article);
    else line(article.body.trimEnd());
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
