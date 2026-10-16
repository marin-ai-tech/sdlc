import type { ProjectContext } from '../cli/context.js';
import type { ChangeRef } from './changes.js';
import { checkDeltaTargets, readChangeDeltas } from './deltas.js';
import { t } from './i18n.js';
import { openspecFailure, runOpenSpecJson } from './openspec.js';
import { readOpenSpecMetadata } from './openspec-schema.js';

export interface ValidationIssue {
  source: 'openspec' | 'sdlc';
  level: 'error' | 'warning' | 'info';
  path?: string;
  line?: number;
  message: string;
  textKey?: string;
}

interface OpenSpecValidateItem {
  id: string;
  valid: boolean;
  issues: Array<{ level: string; path?: string; message: string; line?: number }>;
}

export function validateOne(ctx: ProjectContext, ref: ChangeRef): {
  change: string; valid: boolean; issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const deltas = readChangeDeltas(ref.dir);
  const skipSpecs = readOpenSpecMetadata(ref.dir).skip_specs === true;
  if (deltas.length === 0 && !skipSpecs) {
    issues.push({ source: 'sdlc', level: 'error',
      message: t('validate.noDeltaSpecs', undefined, 'en'), textKey: 'validate.noDeltaSpecs' });
  } else if (deltas.length > 0) {
    const result = runOpenSpecJson<{ items?: OpenSpecValidateItem[] }>(
      ['validate', ref.id, '--type', 'change', '--strict', '--no-interactive'], ctx.root,
    );
    const item = result.data?.items?.[0];
    if (!item) {
      issues.push({ source: 'openspec', level: 'error',
        message: `openspec validate failed: ${openspecFailure(result.data, result.raw)}` });
    } else {
      for (const issue of item.issues) {
        const level = issue.level.toLowerCase() === 'error' ? 'error'
          : issue.level.toLowerCase() === 'warning' ? 'warning' : 'info';
        issues.push({ source: 'openspec', level, message: issue.message,
          ...(issue.path ? { path: issue.path } : {}), ...(issue.line ? { line: issue.line } : {}) });
      }
    }
    issues.push(...checkDeltaTargets(ctx.paths, deltas).map((issue) => ({
      source: 'sdlc' as const, level: issue.level, path: issue.file,
      line: issue.line, message: issue.message,
    })));
  }
  return { change: ref.id, valid: !issues.some((issue) => issue.level === 'error'), issues };
}
