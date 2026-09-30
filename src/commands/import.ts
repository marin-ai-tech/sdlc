import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { readChangeState } from '../core/change-state.js';
import { assertValidChangeId } from '../core/changes.js';
import { addDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { isWithin } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { planBmadImport } from '../core/import-bmad.js';
import { createChange } from './changes.js';

export function importBmadCommand(input: string, opts: { change: string; kind?: string; risk?: string; dryRun?: boolean; json?: boolean }): void {
  try {
    assertValidChangeId(opts.change);
    const ctx = loadProject();
    const target = path.join(ctx.paths.changesDir, opts.change);
    if (fs.existsSync(target)) throw new SdlcError('change_exists', `Change ${opts.change} already exists.`);
    const plan = planBmadImport(ctx.root, input, opts.change);
    if (opts.dryRun) { if (opts.json) printJson(plan); else line(JSON.stringify(plan, null, 2)); return; }
    const { dir } = createChange(opts.change, { kind: opts.kind, risk: opts.risk, sourceType: 'bmad', sourceRef: input });
    for (const file of plan.files) {
      const dest = path.resolve(dir, file.path);
      if (!isWithin(dir, dest)) throw new SdlcError('invalid_path', 'Import path escapes change folder.');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf8');
    }
    const sourceDir = path.join(dir, 'sources', 'bmad');
    fs.mkdirSync(sourceDir, { recursive: true });
    for (const doc of plan.docs) {
      const source = path.resolve(ctx.root, doc.path);
      const dest = path.resolve(sourceDir, path.basename(doc.path));
      if (!isWithin(sourceDir, dest) || fs.lstatSync(source).isSymbolicLink()) throw new SdlcError('invalid_path', 'Invalid BMAD source.');
      fs.copyFileSync(source, dest);
    }
    const by = formatIdentity(gitIdentity(ctx.root));
    for (const item of plan.deferred) addDeferred(ctx.root, { ...item, change: opts.change, by });
    recordChangeEvent(ctx, { id: opts.change, dir }, readChangeState(dir), 'change.imported', by, input);
    if (opts.json) printJson(plan); else line(`Imported BMAD artifacts into ${opts.change}.`);
  } catch (error) { reportFailure(error, opts.json); }
}
