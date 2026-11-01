import * as path from 'node:path';
const VALUES = {
    env: ['-u', '--unset', '-C', '--chdir'],
    sudo: ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from',
        '-D', '--chdir', '-R', '--chroot', '-T', '--command-timeout'],
    exec: ['-a'],
};
const FLAGS = {
    env: /^(?:-|-[i0v]+|--ignore-environment|--null|--debug)$/,
    sudo: /^(?:-[nEHSbkKBP]+|--non-interactive|--preserve-env(?:=.*)?|--set-home|--stdin|--background)$/,
    exec: /^-[cl]+$/,
    command: /^-p+$/,
};
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const basename = (word = '') => path.posix.basename(word.replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase();
/** Known wrappers retain their execution directory; querying a command never executes its data arguments. */
export function programLocation(words, cwd) {
    const state = { at: 0, dir: cwd };
    while (ASSIGNMENT.test(words[state.at] ?? ''))
        state.at++;
    while (/^(?:env|command|exec|sudo)$/.test(basename(words[state.at]))) {
        const wrapper = basename(words[state.at++]);
        if (!wrapperOptions(words, wrapper, state))
            return { ...state, at: -1 };
    }
    return state;
}
function wrapperOptions(words, wrapper, state) {
    let options = true;
    let changedDirectory = false;
    while (state.at < words.length) {
        const word = words[state.at];
        if ((wrapper === 'env' || wrapper === 'sudo') && ASSIGNMENT.test(word)) {
            state.at++;
            continue;
        }
        if (!options || !word.startsWith('-'))
            break;
        state.at++;
        if (word === '--') {
            options = false;
            continue;
        }
        if (/^--(?:help|version)$/.test(word) || wrapper === 'command' && /^-[pvV]*[vV][pvV]*$/.test(word))
            return false;
        const option = /^([^=]+)=(.*)$/s.exec(word) ?? /^(-[ugphCDRTa])(.+)$/.exec(word);
        const name = option?.[1] ?? word;
        if (!VALUES[wrapper]?.includes(name)) {
            if (!FLAGS[wrapper]?.test(word))
                state.problem ??= 'Cannot statically resolve execution wrapper options.';
            continue;
        }
        const value = option?.[2] ?? words[state.at++];
        const directory = name === '--chdir' || wrapper === 'env' && name === '-C' || wrapper === 'sudo' && name === '-D';
        if (directory) {
            setDirectory(state, value, changedDirectory);
            changedDirectory = true;
        }
        else if (name === '-R' || name === '--chroot' || value === undefined) {
            state.dir = undefined;
            state.problem ??= 'Cannot statically resolve execution wrapper root or option value.';
        }
    }
    return true;
}
function setDirectory(state, value, repeated) {
    if (repeated || value === undefined || /[$`~%]/.test(value)
        || process.platform === 'win32' && /^\/[^/]/.test(value)) {
        state.dir = undefined;
        state.problem ??= 'Cannot statically resolve execution wrapper working directory.';
        return;
    }
    state.dir = path.isAbsolute(value) ? path.resolve(value) : state.dir === undefined ? undefined : path.resolve(state.dir, value);
}
