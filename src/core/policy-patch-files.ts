/** Files named by an apply_patch envelope or a unified diff. */
export function patchFiles(patch: string): string[] {
  const files: string[] = [];
  const envelope = /^\*\*\*\s+(?:(?:Update|Add|Delete)\s+File|Move\s+to):\s*(.+)$/gm;
  const unified = /^\+\+\+\s+(?:b\/)?(.+)$/gm;
  for (const match of patch.matchAll(envelope)) files.push(match[1].trim());
  for (const match of patch.matchAll(unified)) {
    const file = match[1].trim();
    if (file !== '/dev/null') files.push(file);
  }
  return files;
}
