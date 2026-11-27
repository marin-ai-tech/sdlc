import { InvalidArgumentError } from 'commander';
import { assertBaseRef } from '../core/base-ref.js';
import { SdlcError } from '../core/errors.js';
/**
 * The parser of every `--base <ref>` option (B249): a value that is not a plain ref (it starts with "-", or holds
 * spaces, shell characters or a commit-message search, review round 2 F1) is refused before the command runs, so it
 * never reaches git or the output. Commander reports it naming the option and exits non-zero.
 */
export function baseOption(value) {
    try {
        return assertBaseRef(value, '--base');
    }
    catch (error) {
        if (error instanceof SdlcError)
            throw new InvalidArgumentError(error.localizedMessage());
        throw error;
    }
}
