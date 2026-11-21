import { generatedNotice } from '../core/license.js';
import { packWorkflows } from '../team/pack-effect.js';
import { appendNotice, yamlString } from './render.js';
import { teamSkillRoots } from './skills.js';
/**
 * The workflows of the accepted packs (B18) as skills `sdlc-<pack>-<id>/SKILL.md` in the skills folder of each
 * configured tool, like the built-in workflows (none with `delivery: commands`, which has no skills). The manifest
 * owns them (`kind: pack-skill`), so a workflow no longer in effect goes with the next refresh. The pack's text is
 * written as it came: no pre-allowed tools, no template expansion. A built-in name is refused in pack-contents.ts.
 */
export function renderPackWorkflows(ctx) {
    if (ctx.root === undefined || ctx.delivery === 'commands')
        return [];
    const workflows = packWorkflows(ctx.root, ctx.config);
    if (workflows.length === 0)
        return [];
    const roots = teamSkillRoots(ctx.tools);
    return roots.flatMap((root) => workflows.map((workflow) => packSkill(root, workflow, ctx)));
}
function packSkill(root, workflow, ctx) {
    const content = appendNotice([
        '---',
        `name: ${workflow.name}`,
        `description: ${yamlString(workflow.description)}`,
        'metadata:',
        `  pack: ${yamlString(workflow.pack)}`,
        `  generatedBy: "sdlc ${ctx.version}"`,
        '---',
        '',
        workflow.body,
    ].join('\n'), generatedNotice(ctx.stamp, 'markdown'));
    return { path: `${root}/${workflow.name}/SKILL.md`, content, tool: 'shared', kind: 'pack-skill' };
}
