import { SdlcError } from './errors.js';
const PROGRAM = /^(?:.*\/)?sdlc(?:\.js)?$/;
const LAUNCHER_OPTIONS = new Map([
    ['npx', ['--no-install', '-y', '--yes', '--offline']],
    ['pnpm', ['exec']],
    ['yarn', ['exec']],
    ['bunx', []],
    ['node', []],
]);
/** A hook command may name its program once, last, after an approved launcher or on its own. */
export function assertCliValue(value, where) {
    const fix = { key: 'fix.cliProgram' };
    if (!/^[A-Za-z0-9@._/: -]+$/.test(value)) {
        throw new SdlcError('invalid_config', {
            key: 'error.x_may_only_contain_letters_digits_spaces_and', params: { p1: where },
        }, fix);
    }
    const words = value.split(' ');
    const programs = words.filter((word) => PROGRAM.test(word));
    const options = LAUNCHER_OPTIONS.get(words[0]);
    const launcherValid = PROGRAM.test(words[0])
        ? words.length === 1
        : options !== undefined && words.slice(1, -1).every((word) => options.includes(word));
    if (words.includes('') || programs.length !== 1 || !PROGRAM.test(words.at(-1) ?? '')
        || !launcherValid) {
        throw new SdlcError('invalid_config', {
            key: 'error.cliNotProgram', params: { field: where, value },
        }, fix);
    }
}
