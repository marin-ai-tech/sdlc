import type { ChangeRef } from './changes.js';
import type { SdlcConfig } from './config.js';
import { toDiagnostic } from './errors.js';
import { evaluateChange, type LifecycleView } from './lifecycle.js';

export interface ChangeEvaluationError {
  change: string;
  code: string;
  message: string;
}

export interface EvaluatedChange {
  ref: ChangeRef;
  view: LifecycleView;
}

/** A bad change is reported once and cannot contribute work to a shared view. */
export function evaluateEach(root: string, refs: ChangeRef[], config: SdlcConfig,
  options: Parameters<typeof evaluateChange>[3] = {}): {
    evaluated: EvaluatedChange[];
    errors: ChangeEvaluationError[];
  } {
  const evaluated: EvaluatedChange[] = [];
  const errors: ChangeEvaluationError[] = [];
  for (const ref of refs) {
    try {
      evaluated.push({ ref, view: evaluateChange(root, ref, config, options) });
    } catch (error) {
      const diagnostic = toDiagnostic(error);
      errors.push({ change: ref.id, code: diagnostic.code, message: diagnostic.message });
    }
  }
  return { evaluated, errors };
}
