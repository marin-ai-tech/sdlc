import { findSecrets } from './policy-secrets.js';
const KIND_NAMES = {
    aws: 'AWS key', github: 'GitHub token', gitlab: 'GitLab token', slack: 'Slack token',
    google: 'Google API key', privateKey: 'private key', url: 'URL password',
    assignment: 'credential', bearer: 'bearer token',
};
/** Mask a person's free-text input before commands, records, logs, events or echoed invocations see it. */
export function maskPersonNote(text) {
    const findings = findSecrets(text);
    let masked = text;
    for (const finding of findings) {
        masked = masked.split(finding.value).join(`[masked: ${KIND_NAMES[finding.kind]}]`);
    }
    return { text: masked, masked: findings.length > 0 };
}
const RECORDED_TEXT_OPTIONS = new Set([
    '--note', '--title', '--goal', '--outcome', '--accept', '--add-accept',
    '--why', '--revisit', '--description',
]);
function titleCommand(argv) {
    return argv[2] === 'backlog' && (argv[3] === 'add' || (argv[3] === 'epic' && argv[4] === 'add')) || argv[2] === 'defer' && argv[3] === 'add';
}
/** Mask recorded free text before Commander and the invocation record see it. */
export function maskNoteArguments(argv) {
    let warned = false;
    const answer = argv.includes('answer');
    const freeReason = argv[2] === 'config' && argv[3] === 'propose'
        || argv[2] === 'board' && argv[3] === 'reopen';
    const titleStart = argv[3] === 'epic' ? 5 : 4;
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        const name = arg.split('=', 1)[0];
        const recorded = RECORDED_TEXT_OPTIONS.has(name) || answer && name === '--text'
            || freeReason && name === '--reason';
        const option = recorded && arg === name;
        const equals = recorded && arg.startsWith(`${name}=`);
        const positional = titleCommand(argv) && index >= titleStart && !arg.startsWith('-');
        if (!option && !equals && !positional)
            continue;
        const value = option ? argv[index + 1] : equals ? arg.slice(name.length + 1) : arg;
        if (value === undefined)
            continue;
        const result = maskPersonNote(value);
        warned ||= result.masked;
        if (option)
            argv[index + 1] = result.text;
        else if (equals)
            argv[index] = `${name}=${result.text}`;
        else
            argv[index] = result.text;
        if (option)
            index++;
    }
    return warned;
}
