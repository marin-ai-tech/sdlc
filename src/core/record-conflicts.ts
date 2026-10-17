import * as fs from 'node:fs';
import * as path from 'node:path';

/** Change records with a complete Git conflict marker set. */
export function conflictedRecords(root: string): string[] {
  const changes = path.join(root, 'openspec', 'changes');
  if (!fs.existsSync(changes)) return [];
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      if (!entry.isFile() || entry.name !== '.sdlc.yaml') continue;
      const value = fs.readFileSync(file, 'utf8');
      if (/^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m.test(value)) {
        const relative = path.relative(changes, dir).split(path.sep).join('/');
        found.push(relative.replace(/[\x00-\x1f\x7f]/g, '?'));
      }
    }
  };
  visit(changes);
  return found;
}
