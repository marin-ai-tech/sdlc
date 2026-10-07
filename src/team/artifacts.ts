import { t, type Locale } from '../core/i18n.js';
import type { StageConfigId } from '../core/stage-config.js';

/**
 * `{{artifacts}}` of a role (B70): where the role writes. The artifacts of each of its stages, in the change folder,
 * and the command that hands the agent an artifact's template, rules and context.
 */
const STAGE_ARTIFACTS: Record<StageConfigId, string[]> = {
  plan: ['intent.md'],
  design: ['proposal.md', 'specs/<capability>/spec.md', 'design.md'],
  build: ['plan.md', 'tasks.md'],
  test: ['verification.md'],
  deploy: ['review.md', 'release.md'],
  maintain: [],
};

function code(values: string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

function stageLine(stage: StageConfigId, locale: Locale): string | undefined {
  const files = STAGE_ARTIFACTS[stage];
  if (files.length === 0) return undefined;
  const list = stage === 'build' ? t('team.artifacts.withCode', { files: code(files) }, locale) : code(files);
  return `- \`${stage}\`: ${list}`;
}

/** The "Where to write" block for a role with these stages, in the locale; `cli` is the project's CLI prefix. */
export function artifactsBlock(stages: StageConfigId[], locale: Locale, cli: string): string {
  const lines = stages.flatMap((stage) => stageLine(stage, locale) ?? []);
  const command = `${cli} instructions <artifact> --change <id>`;
  return [
    t('team.artifacts.title', {}, locale),
    '',
    lines.length > 0 ? t('team.artifacts.intro', {}, locale) : t('team.artifacts.none', {}, locale),
    ...lines,
    '',
    t('team.artifacts.instructions', { command }, locale),
  ].join('\n');
}
