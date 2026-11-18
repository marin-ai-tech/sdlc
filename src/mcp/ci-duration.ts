function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Provider wall time, distinct from the local MCP call's polling time. */
export function providerDurationMs(tool: string, result: unknown): number | undefined {
  if (tool === 'list_workflow_runs') {
    const runs = object(result)?.workflow_runs;
    if (!Array.isArray(runs)) return undefined;
    const spans = runs.flatMap((item) => {
      const run = object(item);
      if (run?.status !== 'completed') return [];
      const start = typeof run.run_started_at === 'string' ? Date.parse(run.run_started_at) : NaN;
      const end = typeof run.updated_at === 'string' ? Date.parse(run.updated_at) : NaN;
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [{ start, end }] : [];
    });
    return spans.length > 0
      ? Math.max(...spans.map((span) => span.end)) - Math.min(...spans.map((span) => span.start))
      : undefined;
  }
  if (tool === 'list_pipelines' && Array.isArray(result)) {
    const durations = result.map((item) => object(item)?.duration)
      .filter((duration): duration is number => typeof duration === 'number'
        && Number.isFinite(duration) && duration >= 0);
    return durations.length > 0 ? Math.max(...durations) * 1000 : undefined;
  }
  return undefined;
}
