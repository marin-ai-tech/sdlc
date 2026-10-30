import { gitIdentity } from './git.js';
import { approveCli, sharedFingerprint } from './lifecycle.js';
import { evaluateEach } from './evaluate-each.js';
import { personByEmail, readRolesFile } from './roles.js';
/** The queue of the current git identity over `scope.refs`. */
export function myQueue(scope) {
    const roles = readRolesFile(scope.root);
    const email = gitIdentity(scope.root).email?.toLowerCase() ?? null;
    const person = roles && email ? personByEmail(roles, email)?.id ?? null : null;
    const me = { email, person };
    const fingerprint = sharedFingerprint(scope.root);
    const { evaluated, errors } = evaluateEach(scope.root, scope.refs, scope.config, { fingerprint });
    const errorField = errors.length > 0 ? { errors } : {};
    if (roles && !person)
        return { me, items: [], anyone: false, reason: 'not_in_roles', ...errorField };
    const items = evaluated
        .flatMap(({ view }) => waitingItem(view, person))
        .sort((a, b) => (a.change < b.change ? -1 : a.change > b.change ? 1 : 0));
    return { me, items, anyone: !roles, ...errorField };
}
/** The change's gate when it waits for a person's approval and (with roles.yaml) that person is me. */
function waitingItem(view, person) {
    const next = view.next;
    if (next.actor !== 'human' || !['approve-gate', 'answer-questions'].includes(next.action)
        || !next.gate || !next.cli)
        return [];
    const digest = next.action === 'approve-gate' ? view.gates.find((gate) => gate.id === next.gate)?.digest : undefined;
    const item = { change: view.change, gate: next.gate, action: next.action, cli: next.cli, message: next.message,
        ...(digest ? { digest } : {}) };
    if (!person)
        return [item];
    const named = next.people?.find((candidate) => candidate.id === person);
    if (!named)
        return [];
    // A planning gate's command names the role; it is the role I approve in, not the first one awaited.
    const withRole = next.action === 'approve-gate' && next.cli.includes(' --as ')
        ? approveCli(view.change, next.gate, named.role)
        : next.cli;
    return [{ ...item, cli: withRole }];
}
