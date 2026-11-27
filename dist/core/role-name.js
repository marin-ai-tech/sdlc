/**
 * A role name is a plain token: a letter, then letters, digits, `.`, `_` or `-`. Role names go into the approval
 * commands sdlc suggests (`--as <role>`), so one that carries a space or an option could make a person decide another
 * change; the roles file and the config refuse anything else when they are parsed.
 */
export const ROLE_NAME = /^[A-Za-z][A-Za-z0-9._-]*$/;
export function isRoleName(name) {
    return ROLE_NAME.test(name);
}
