/** Small boundary readers shared by persisted decision records. */
export function recordObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function stringFields(raw: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => typeof raw[key] === 'string')
    && optional.every((key) => raw[key] === undefined || typeof raw[key] === 'string');
}
