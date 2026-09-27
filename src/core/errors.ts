/**
 * A failure the CLI reports as a diagnostic instead of a stack trace.
 *
 * `code` is a stable snake_case identifier agents can branch on, `fix` is one
 * actionable sentence or command. The shape mirrors OpenSpec's diagnostic
 * envelope (severity/code/message/fix) so agents that already parse OpenSpec
 * JSON can read ours the same way.
 */
export class SdlcError extends Error {
  readonly code: string;
  readonly fix?: string;

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = 'SdlcError';
    this.code = code;
    this.fix = fix;
  }
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  fix?: string;
}

export function toDiagnostic(error: unknown): Diagnostic {
  if (error instanceof SdlcError) {
    return {
      severity: 'error',
      code: error.code,
      message: error.message,
      ...(error.fix ? { fix: error.fix } : {}),
    };
  }
  return {
    severity: 'error',
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error),
  };
}
