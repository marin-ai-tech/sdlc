import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeNewlines, readText } from '../core/fs-utils.js';
import { generatedNotice, harnessStamp, INSTALL_COMMAND, LEGAL_FILES, LICENSE_REFERENCE, LICENSE_SUMMARY, LICENSOR, LICENSOR_URL, PROJECT_URL, REQUIRED_NOTICE, } from '../core/license.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
import { harnessVersion } from '../core/version.js';
import { AGENT_IDS, loadAgent, loadWorkflow, WORKFLOW_IDS } from './assets.js';
import { renderPluginHooks } from './plugin-hooks.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { allowedToolsFor } from './skills.js';
export const PLUGIN_NAME = 'sdlc';
/** What the plugin stores and where it can send data, for the plugin directory's data-handling answers. */
const PRIVACY_SECTION = [
    '## Data and privacy',
    '',
    '- sdlc runs on your machine. It has no telemetry and no account; its authors receive no data.',
    '- Approval records store the git name and email of the person who approves, in the project\'s own files',
    '  (openspec/), next to the decisions, check output and the event log. They follow your repository\'s retention.',
    '- Network access happens only to what the project configures in openspec/sdlc.yaml:',
    '  - event receivers (MCP servers such as a chat or GitHub): after a CLI command, queued events with the project,',
    '    the change id, the gate, the decision and the people\'s ids from roles.yaml; chat handles only to a receiver',
    '    with chat, the note of a rejection only to a receiver with include_note: true;',
    '  - MCP servers read by `sdlc context pull`;',
    '  - extension pack sources (git or npm) fetched by `sdlc team sync`.',
    '- `sdlc mcp serve --http` listens only when a person starts it.',
    '',
    `Privacy: [PRIVACY.md](${PROJECT_URL}/blob/master/PRIVACY.md)`,
];
export function renderClaudePlugin(cli = 'sdlc') {
    const version = harnessVersion();
    // The plugin is distributed by the licensor itself, so its notices name the
    // license terms but not a project's choice between them.
    const notice = generatedNotice(harnessStamp({ license: { type: 'community' } }, version), 'markdown', false);
    const files = [];
    files.push({
        path: '.claude-plugin/plugin.json',
        content: `${JSON.stringify({
            name: PLUGIN_NAME,
            version,
            description: 'Human-gated SDLC for AI coding agents: workflows from intent to release, approvals only by people, '
                + 'verification evidence and review, built on OpenSpec. Requires the sdlc CLI from the GitHub release '
                + `(${PROJECT_URL}/releases/latest), not the unrelated npm package of that name.`,
            author: { name: LICENSOR, url: LICENSOR_URL },
            homepage: PROJECT_URL,
            repository: PROJECT_URL,
            license: LICENSE_REFERENCE,
            keywords: ['sdlc', 'openspec', 'spec-driven', 'gates', 'governance'],
        }, null, 2)}\n`,
    });
    files.push({
        path: '.claude-plugin/icon.png',
        content: fs.readFileSync(path.join(harnessPackageDir(), 'assets/plugin/icon.png')),
    });
    for (const id of WORKFLOW_IDS) {
        const wf = loadWorkflow(id);
        files.push({
            path: `skills/${id}/SKILL.md`,
            content: appendNotice([
                '---',
                `name: ${id}`,
                `description: ${yamlString(wf.description)}`,
                ...(wf.whenToUse ? [`when_to_use: ${yamlString(wf.whenToUse)}`] : []),
                ...(wf.argumentHint ? [`argument-hint: ${yamlString(wf.argumentHint)}`] : []),
                `license: ${yamlString(LICENSE_SUMMARY)}`,
                `compatibility: ${yamlString(`Requires the sdlc CLI (${cli}) from the sdlc package.`)}`,
                `allowed-tools: ${allowedToolsFor(cli)}`,
                'metadata:',
                `  author: ${yamlString(LICENSOR)}`,
                '  version: "1"',
                `  generatedBy: "sdlc ${version}"`,
                '---',
                '',
                renderBody(wf.body, { surface: 'plugin-skill', cli }),
            ].join('\n'), notice),
        });
    }
    for (const id of AGENT_IDS) {
        const agent = loadAgent(id);
        const tools = agent.tools.map((t) => ({ read: 'Read', grep: 'Grep', glob: 'Glob', bash: 'Bash', edit: 'Edit', write: 'Write' }[t] ?? t)).join(', ');
        files.push({
            path: `agents/${agent.name}.md`,
            content: appendNotice([
                '---',
                `name: ${agent.name}`,
                `description: ${yamlString(agent.description)}`,
                `tools: ${tools}`,
                '---',
                '',
                renderBody(agent.body, { surface: 'claude-agent', cli }),
            ].join('\n'), notice),
        });
    }
    files.push(...renderPluginHooks(cli));
    files.push({
        path: 'README.md',
        content: [
            '# sdlc - Claude Code plugin',
            '',
            'Generated by `sdlc plugin build` from the templates in this repository; do not edit by hand.',
            '',
            'Install the CLI once per machine, add the marketplace, install the plugin, then set up each project:',
            '',
            '```bash',
            `${INSTALL_COMMAND}   # provides the \`sdlc\` CLI (and OpenSpec)`,
            '```',
            '',
            '```text',
            '/plugin marketplace add marin-ai-tech/sdlc',
            '/plugin install sdlc@sdlc',
            '```',
            '',
            '```bash',
            'sdlc init --tools none        # OpenSpec root, sdlc schema, openspec/sdlc.yaml (Claude files come from the plugin)',
            'sdlc init --tools opencode    # ...or also set up OpenCode in the same project',
            '```',
            '',
            'Workflows: ' + WORKFLOW_IDS.map((id) => `\`/sdlc:${id}\``).join(', ') + '.',
            '',
            ...PRIVACY_SECTION,
            '',
            '## License',
            '',
            'sdlc, including this plugin, is dual-licensed: free under the Community License (PolyForm Noncommercial 1.0.0 with',
            'the sdlc Additional Permissions) for noncommercial use, open source projects and a 30-day evaluation; every other',
            'use needs a commercial license. See [LICENSE](LICENSE) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).',
            '',
            REQUIRED_NOTICE,
            '',
        ].join('\n'),
    });
    // Every copy of the plugin carries the license terms and the Required Notice.
    for (const rel of LEGAL_FILES) {
        const content = readText(path.join(harnessPackageDir(), rel));
        if (content !== undefined)
            files.push({ path: rel, content: normalizeNewlines(content) });
    }
    return files;
}
export function renderMarketplace() {
    return `${JSON.stringify({
        name: 'sdlc',
        owner: { name: LICENSOR, url: LICENSOR_URL },
        description: 'AI-native SDLC harness for Claude Code, built on OpenSpec',
        plugins: [
            {
                name: PLUGIN_NAME,
                source: './plugin',
                description: 'AI-native SDLC workflows with human gates, verification evidence and review, built on OpenSpec',
                version: harnessVersion(),
                category: 'development',
                tags: ['sdlc', 'openspec', 'spec-driven', 'governance'],
            },
        ],
    }, null, 2)}\n`;
}
