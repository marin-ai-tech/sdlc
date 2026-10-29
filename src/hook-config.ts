import * as fs from 'node:fs';
import { parse } from 'yaml';
import { toDiagnostic } from './core/errors.js';
import { t } from './core/i18n.js';
import type { Decision } from './core/policy.js';

function configLabel(file: string): string {
  return file.replaceAll('\\', '/').split('/').slice(-2).join('/');
}

/** A failed config load can only honor an explicit YAML string `off`. */
export function configModeIsOff(file: string): boolean {
  try {
    const raw: unknown = parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const enforcement = (raw as Record<string, unknown>).enforcement;
    if (!enforcement || typeof enforcement !== 'object' || Array.isArray(enforcement)) return false;
    return (enforcement as Record<string, unknown>).mode === 'off';
  } catch {
    return false;
  }
}

function loadDetail(file: string, error: unknown): string {
  const diagnostic = toDiagnostic(error);
  return t('hook.configLoad', {
    file: configLabel(file), code: diagnostic.code, message: diagnostic.message,
    fix: diagnostic.fix ?? t('fix.configLoad'),
  });
}

export function configLoadDecision(file: string, error: unknown): Decision {
  return { decision: 'deny', rule: 'config-load', reason: loadDetail(file, error) };
}

export function configLoadSessionLine(file: string, error: unknown): string {
  const diagnostic = toDiagnostic(error);
  return t('session.configLoad', { file: configLabel(file), code: diagnostic.code });
}

export function configLoadStopMessage(file: string, error: unknown): string {
  return t('hook.configLoadStop', { detail: loadDetail(file, error) });
}
