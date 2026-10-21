import { SdlcError } from './errors.js';
import { oneLine, readBacklog, save } from './backlog.js';
function validateEpicEdit(input) {
    if (input.title === undefined && input.goal === undefined && !input.clearGoal) {
        throw new SdlcError('invalid_option', { key: 'error.backlog_edit_requires_field' });
    }
    if (input.goal !== undefined && input.clearGoal) {
        throw new SdlcError('invalid_option', { key: 'error.epic_edit_conflicting_goal' });
    }
    if (input.title !== undefined) {
        oneLine(input.title, 'title');
    }
    if (input.goal !== undefined) {
        oneLine(input.goal, 'goal');
    }
}
/** Changes an epic's title or goal; items, their order and the order of epics stay as they are. */
export function editEpic(root, id, input) {
    const backlog = readBacklog(root);
    const epic = backlog.epics.find((entry) => entry.id === id);
    if (!epic) {
        throw new SdlcError('unknown_epic', { key: 'error.unknown_epic_x', params: { id } });
    }
    validateEpicEdit(input);
    epic.title = input.title ?? epic.title;
    if (input.clearGoal) {
        delete epic.goal;
    }
    else {
        epic.goal = input.goal ?? epic.goal;
    }
    save(root, backlog);
    return readBacklog(root).epics.find((entry) => entry.id === id);
}
