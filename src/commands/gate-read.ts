import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { APPROVAL_GATES, type ApprovalGateId } from '../core/config.js';
import { readGate } from '../core/gate-read.js';
import { t } from '../core/i18n.js';
import { parseGate } from './gates.js';
import { terminalFile, terminalText } from '../core/terminal-text.js';

export function gateReadCommand(gateArg: string, opts: { change?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, APPROVAL_GATES) as ApprovalGateId;
    const ref = resolveChange(ctx.paths, opts.change);
    const result = readGate(ctx.root, ref, ctx.config, gate);
    if (opts.json) return printJson(result);
    line(terminalText(`${result.change}: ${gate} (${result.status})`));
    if (!result.snapshot) return;
    line(result.snapshot.digest);
    if (result.snapshot.fingerprint) {
      line(t('gate.snapshotFingerprint', { fingerprint: terminalText(result.snapshot.fingerprint) }));
    }
    if (result.snapshot.verification) {
      line(t('gate.snapshotVerification', { verification: terminalText(result.snapshot.verification) }));
    }
    for (const file of result.snapshot.files) {
      for (const framed of terminalFile(file.path, file.text)) line(framed);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
