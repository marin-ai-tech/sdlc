import picomatch from 'picomatch';
import { joinContinuations, humanCommandMatch, CLI_PREFIX } from './human-command-match.js';
import { quotedCommand } from './human-command.js';
import { t } from './i18n.js';
import { clearsAgentMarker, clearedAgentMarkers } from './policy-markers.js';
import { removesSdlcCli } from './policy-cli.js';
import { shellWords } from './shell-words.js';
import { commandSpellings, copyDecision, firstDecision, pathSpellings, stateWriteDenial } from './policy-spellings.js';
import { shellCliProblem } from './shell-cli.js';
import { launcherDecision } from './launcher-targets.js';
import { guardDenial, shellGuardWrites } from './policy-guard.js';
import { userShellGuardWrites } from './user-guard.js';
import { shellSecretDenial } from './policy-secrets.js';
import { shellTakeoverDenial } from './takeover.js';
import { shellWriteDestinations } from './policy-shell-writes.js';
import { hiddenTargetHits } from './shell-hidden-targets.js';
import { wholeTreeGitWrite } from './shell-writers.js';
import { openspecNewChange, openspecWrite } from './openspec-guard.js';
const TIME_REASON = 'Checking the literal shell values took too long. '
    + 'Split the command or put the commands in a script file.';
const LIMIT_REASON = 'Literal shell values exceed the static spelling limit. '
    + 'Split the loop or put the commands in a script file.';
const TIMEOUT = Symbol('literal-timeout');
function refusal(reason) {
    return { decision: 'deny', rule: 'shell-parse', reason };
}
function checkpoint(deadline) {
    if (deadline !== undefined && Date.now() >= deadline)
        throw TIMEOUT;
}
function each(spellings, check, deadline) {
    const found = [];
    for (const spelled of spellings) {
        checkpoint(deadline);
        found.push(...check(spelled));
    }
    return [...new Set(found)];
}
function first(spellings, check, deadline) {
    return firstDecision(spellings, (spelled) => {
        checkpoint(deadline);
        return check(spelled);
    });
}
function inspectSpellings(command, cmd, ctx, env, cwd, soft, checks, spellings, writeSpellings, writtenPass, deadline) {
    const state = first(spellings, (spelled) => stateWriteDenial(spelled, ctx.paths.root, cwd), deadline);
    if (state)
        return state;
    if (writtenPass) {
        const copy = copyDecision(command, ctx.paths.root, cwd);
        if (copy)
            return copy;
        const execution = shellCliProblem(command);
        if (execution)
            return refusal(execution);
        const launcher = launcherDecision({ tool: 'Bash', kind: 'bash', command, cwd, files: [] }, ctx.paths.root, ctx.config);
        if (launcher)
            return launcher;
    }
    // The guard's own configuration (B41) and user-level settings (B42); review policy may be configured (B75).
    const policy = [ctx.config.review.policy];
    const guardHits = each(spellings, (spelled) => [
        ...shellGuardWrites(spelled, ctx.paths.root, cwd, policy),
        ...userShellGuardWrites(spelled, cwd, env),
    ], deadline);
    const guard = guardDenial(guardHits);
    if (guard)
        return guard;
    if (writtenPass) {
        // A shell write has no reliable target, so a key or token has no exemption (B16).
        const secret = shellSecretDenial(cmd);
        if (secret)
            return secret;
    }
    // A change a person holds: no shell writes to its paths, or non-read-only sdlc steps on it.
    const held = first(spellings, (spelled) => shellTakeoverDenial(ctx.paths, spelled, cwd, CLI_PREFIX), deadline);
    if (held)
        return held;
    // Shell writes count for tests-locked and the plan gate just like edits (B82).
    const written = each(writeSpellings, (spelled) => shellWriteDestinations(spelled, ctx.paths.root, cwd), deadline);
    const hidden = each(spellings, (spelled) => hiddenTargetHits(spelled, cwd, /./), deadline);
    const wholeTree = writeSpellings.some((spelled) => {
        checkpoint(deadline);
        return wholeTreeGitWrite(spelled, ctx.paths.root, cwd);
    });
    const isProtected = picomatch(ctx.config.enforcement.protectedPaths, { dot: true, nocase: true });
    const protectedHit = [...written, ...hidden].find((path) => isProtected(path));
    if (protectedHit) {
        return { decision: 'deny', rule: 'protected-path', reason: t('hook.protectedPath', { path: protectedHit }) };
    }
    if (writtenPass) {
        const creation = openspecNewChange(cmd);
        if (creation)
            return soft(creation.rule, creation.reason);
    }
    const openspec = openspecWrite(written, ctx.paths);
    if (openspec)
        return soft(openspec.rule, openspec.reason);
    const locked = hidden.length ? checks.locked(hidden) : undefined;
    if (locked)
        return locked;
    const gated = checks.gated(written, wholeTree);
    if (gated)
        return gated;
    return writtenPass ? checks.release(cmd) : undefined;
}
/** Build bounded literal spellings, then check the written command before inspecting the additions. */
export function evaluateShellCommand(command, ctx, env, cwd, soft, checks) {
    const started = Date.now();
    const interval = ctx.literalDeadlineMs ?? 5000;
    const cmd = joinContinuations(command);
    // Clearing agent markers would also slip past the CLI's own agent check.
    if (clearsAgentMarker(cmd)) {
        return { decision: 'deny', rule: 'agent-marker',
            reason: t('hook.agentMarker', { markers: clearedAgentMarkers(cmd).join(', ') }) };
    }
    const problem = shellWords(command).problem;
    if (problem)
        return refusal(problem);
    const humanCommand = humanCommandMatch(cmd);
    if (ctx.config.enforcement.forbidAgentApprovals && humanCommand) {
        return { decision: 'deny', rule: 'separation-of-duties',
            reason: t('hook.separationOfDuties', { command: quotedCommand(humanCommand) }) };
    }
    if (removesSdlcCli(cmd))
        return { decision: 'deny', rule: 'cli-removal', reason: t('hook.cliRemoval') };
    let commands;
    try {
        commands = commandSpellings(command, Date.now() + Math.min(interval, 500));
    }
    catch {
        return refusal('Literal shell values could not be inspected.');
    }
    if (commands.exceeded)
        return refusal(LIMIT_REASON);
    const baseSpellings = pathSpellings(command);
    const base = inspectSpellings(command, cmd, ctx, env, cwd, soft, checks, baseSpellings, [command], true);
    if (base?.decision === 'deny')
        return base;
    if (commands.timedOut)
        return refusal(TIME_REASON);
    const deadline = Math.min(Date.now() + interval, started + 20000);
    try {
        const original = new Set(baseSpellings);
        const spellings = commands.spellings.filter((spelled) => !original.has(spelled));
        const writeSpellings = commands.writeSpellings.filter((spelled) => spelled !== command);
        if (!spellings.length && !writeSpellings.length)
            return base ?? { decision: 'allow' };
        checkpoint(started + 20000);
        checkpoint(deadline);
        const expanded = inspectSpellings(command, cmd, ctx, env, cwd, soft, checks, spellings, writeSpellings, false, deadline);
        if (base?.decision === 'warn' && expanded?.decision !== 'deny')
            return base;
        return expanded ?? base ?? { decision: 'allow' };
    }
    catch (error) {
        return refusal(error === TIMEOUT ? TIME_REASON : 'Literal shell values could not be inspected.');
    }
}
