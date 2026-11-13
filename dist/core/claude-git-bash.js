import * as path from 'node:path';
import { isFile } from './fs-utils.js';
/** Claude Code's Windows override or standard Git for Windows install locations. Never executes Git or Bash. */
export function claudeGitBash(env = process.env) {
    const override = env.CLAUDE_CODE_GIT_BASH_PATH;
    if (override)
        return isFile(override);
    return [env.ProgramFiles, env.ProgramW6432]
        .filter((dir) => !!dir)
        .some((dir) => isFile(path.join(dir, 'Git', 'bin', 'bash.exe')));
}
/** Suggest the Bash alongside the Git installation on PATH, when its file exists. */
export function gitBashOnPath(env = process.env) {
    const paths = (env.Path ?? env.PATH ?? '').split(path.delimiter);
    for (const dir of paths) {
        if (!dir || !isFile(path.join(dir, 'git.exe')))
            continue;
        const bash = path.resolve(dir, '..', 'bin', 'bash.exe');
        if (isFile(bash))
            return bash;
    }
    return undefined;
}
