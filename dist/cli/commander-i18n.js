import { Help } from 'commander';
import { catalog, currentLocale, t } from '../core/i18n.js';
import { harnessVersion } from '../core/version.js';
const HELP_TITLES = {
    'Usage:': 'commander.usage',
    'Arguments:': 'commander.arguments',
    'Options:': 'commander.options',
    'Commands:': 'commander.commands',
    'Global Options:': 'commander.globalOptions',
};
/** Catalog keys whose English text is an option, argument or commander description. */
const DESCRIPTION_KEY = /^(option|commander)\./;
/** English description -> catalog key, built once from the English catalog. */
let descriptionKeys;
function descriptionKey(text) {
    if (!descriptionKeys) {
        descriptionKeys = new Map();
        for (const [key, value] of Object.entries(catalog('en'))) {
            if (DESCRIPTION_KEY.test(key))
                descriptionKeys.set(value, key);
        }
    }
    return descriptionKeys.get(text);
}
/** The current-locale text of an English description from the catalog; unknown text stays as written. */
function translateDescription(text) {
    const key = descriptionKey(text);
    return key ? t(key) : text;
}
/** Translate every option and argument description in the command tree when the locale is not English. */
export function localizeDescriptions(command) {
    if (currentLocale() === 'en')
        return;
    for (const option of command.options) {
        option.description = translateDescription(option.description);
    }
    for (const argument of command.registeredArguments) {
        argument.description = translateDescription(argument.description);
    }
    for (const child of command.commands)
        localizeDescriptions(child);
}
/** Commander's option text with its "(default: ...)" note in the current locale. */
function localizedOptionDescription(option) {
    const text = Help.prototype.optionDescription.call(this, option);
    return text.replace('(default: ', `(${t('commander.defaultValue')}: `);
}
/** Read `--locale <x>` / `--locale=<x>` from argv before commander parses. */
export function peekLocaleFlag(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--locale') {
            const next = argv[i + 1];
            if (next && !next.startsWith('-'))
                return next;
            return undefined;
        }
        if (arg.startsWith('--locale='))
            return arg.slice('--locale='.length);
    }
    return undefined;
}
function translateErrorBody(body) {
    let m;
    m = body.match(/^error: missing required argument '([^']+)'$/);
    if (m)
        return t('commander.missingArgument', { name: m[1] });
    m = body.match(/^error: option '([^']+)' argument missing$/);
    if (m)
        return t('commander.optionMissingArgument', { flags: m[1] });
    m = body.match(/^error: required option '([^']+)' not specified$/);
    if (m)
        return t('commander.missingMandatoryOption', { flags: m[1] });
    m = body.match(/^error: unknown option '([^']+)'$/);
    if (m)
        return t('commander.unknownOption', { flag: m[1] });
    m = body.match(/^error: unknown command '([^']+)'$/);
    if (m)
        return t('commander.unknownCommand', { name: m[1] });
    m = body.match(/^error: too many arguments( for '[^']+')?\. Expected (\d+) arguments? but got (\d+)\.$/);
    if (m) {
        return t('commander.excessArguments', {
            forSubcommand: m[1] ?? '',
            expected: m[2],
            received: m[3],
        });
    }
    return body;
}
function translateDidYouMean(suffix) {
    let m;
    m = suffix.match(/^\n\(Did you mean one of (.+)\?\)$/);
    if (m)
        return '\n' + t('commander.didYouMeanOneOf', { suggestions: m[1] });
    m = suffix.match(/^\n\(Did you mean (.+)\?\)$/);
    if (m)
        return '\n' + t('commander.didYouMean', { suggestion: m[1] });
    return suffix;
}
/** Translate commander English error lines; leave unrecognized text unchanged. */
export function translateCommanderError(str) {
    const hadNl = str.endsWith('\n');
    const raw = hadNl ? str.slice(0, -1) : str;
    const suggestAt = raw.indexOf('\n(Did you mean');
    const main = suggestAt >= 0 ? raw.slice(0, suggestAt) : raw;
    const suggestion = suggestAt >= 0 ? raw.slice(suggestAt) : '';
    const translated = translateErrorBody(main) + translateDidYouMean(suggestion);
    return hadNl ? translated + '\n' : translated;
}
/**
 * Localize commander help titles, -h/-V text, the implicit help command, default notes and parse errors
 * when the locale is not English.
 */
export function applyCommanderLocale(program) {
    if (currentLocale() === 'en') {
        program.version(harnessVersion());
        return;
    }
    program.version(harnessVersion(), '-V, --version', t('commander.versionOption'));
    program.helpOption('-h, --help', t('commander.helpOption'));
    program.configureHelp({
        styleTitle: (title) => {
            const key = HELP_TITLES[title];
            return key ? t(key) : title;
        },
        subcommandDescription: (cmd) => translateDescription(cmd.summary() || cmd.description()),
        optionDescription: localizedOptionDescription,
    });
    program.configureOutput({
        outputError: (str, write) => {
            write(translateCommanderError(str));
        },
    });
}
