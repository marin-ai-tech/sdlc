import { loadProject } from '../cli/context.js';
import { t } from '../core/i18n.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { saveConfig } from '../core/config.js';
import { formatIdentity, git, gitIdentity } from '../core/git.js';
import { adaptLayout, applyConversion, detectLayout, layoutRole, planConversion, scaffoldLayout } from '../core/layout.js';
import { appendLog } from '../core/log.js';
import { convertInWorktree } from '../core/layout-worktree.js';

export function layoutCommand(action: 'check' | 'scaffold' | 'adapt' | 'convert', opts: { dryRun?: boolean; json?: boolean; apply?: boolean; inPlace?: boolean; worktree?: string; branch?: string }): void {
  try {
    const ctx = loadProject();
    if (action === 'convert') {
      const result = opts.apply && !opts.inPlace ? convertInWorktree(ctx.root, ctx.stamp, opts) : undefined;
      const plan = result?.plan ?? planConversion(ctx.root, ctx.config);
      if (opts.apply && opts.inPlace) {
        applyConversion(ctx.root, ctx.config, plan);
        saveConfig(ctx.paths.sdlcConfig, ctx.config);
        const by = formatIdentity(gitIdentity(ctx.root));
        appendLog(ctx.root, ctx.config, {
          event: 'layout.converted', ...(by ? { by } : {}),
          detail: `Moved ${plan.moves.length} role(s); rewrote ${plan.linkRewrites.length} file(s).`,
        }, ctx.stamp);
      }
      if (opts.json) printJson(result ? { ...result, harness: ctx.stamp } : { plan, applied: !!opts.apply, ...(opts.apply ? { mode: 'in-place' } : {}), harness: ctx.stamp });
      else {
        for (const move of plan.moves) line(t('layout.move', { from: move.from, to: move.to }));
        for (const item of plan.linkRewrites) line(t('layout.rewrite', { file: item.file, links: item.links }));
        for (const item of plan.skipped) line(t('layout.skipped', { path: item.path, reason: item.reason }));
        for (const item of plan.conflicts) line(t('layout.conflict', { from: item.from, to: item.to, reason: item.reason }));
        if (result?.worktree) {
          for (const warning of result.warnings) line(t('layout.warning', { text: warning }));
          const current = git(ctx.root, ['branch', '--show-current']).stdout || 'HEAD';
          line(t('layout.reviewDiff', { current, branch: result.worktree.branch }));
          line(t('layout.mergeHint'));
          line(t('layout.discard', { path: result.worktree.path, branch: result.worktree.branch }));
        } else if (opts.apply) line(result ? result.warnings.join(' ') : t('layout.applied'));
      }
      return;
    }
    if (action === 'check') {
      const report = detectLayout(ctx.root, ctx.config.layout);
      if (opts.json) return printJson({ ...report, harness: ctx.stamp });
      line(t('layout.header'));
      for (const r of report.roles) line(`${r.role} | ${r.status} | ${r.path ?? '-'} | ${t(`layout.purpose.${r.role}`)}`);
      line(report.ready ? t('layout.ready') : t('layout.notReady'));
      for (const warning of report.warnings) line(warning);
      return;
    }
    const before = JSON.stringify(ctx.config.layout);
    const result = action === 'adapt'
      ? adaptLayout(ctx.root, ctx.config, opts)
      : scaffoldLayout(ctx.root, ctx.config, opts);
    if (!opts.dryRun) {
      if (action === 'adapt' && before !== JSON.stringify(ctx.config.layout)) saveConfig(ctx.paths.sdlcConfig, ctx.config);
      const by = formatIdentity(gitIdentity(ctx.root));
      appendLog(ctx.root, ctx.config, {
        event: action === 'adapt' ? 'layout.adapted' : 'layout.scaffolded',
        ...(by ? { by } : {}),
        detail: `Created ${result.created.length} document(s); kept ${result.kept.length}.`,
      }, ctx.stamp);
    }
    if (opts.json) printJson({ ...result, harness: ctx.stamp });
    else {
      line(t(opts.dryRun ? 'layout.wouldCreate' : 'layout.created', { list: result.created.join(', ') || t('layout.none') }));
      line(t('layout.kept', { list: result.kept.join(', ') || t('layout.none') }));
      if (action === 'adapt') line(t('layout.reviewAdapt'));
    }
  } catch (error) { reportFailure(error, opts.json); }
}
