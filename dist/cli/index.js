import { Command } from 'commander';
import { helpCommand } from '../commands/help.js';
import { guideCommand } from '../commands/guide.js';
import { statuslineCommand } from '../commands/statusline.js';
import { archiveCommand, auditCommand, logCommand, validateCommand } from '../commands/lifecycle-ops.js';
import { changelogCommand } from '../commands/changelog.js';
import { licenseCommand } from '../commands/license.js';
import { instructionsCommand, newCommand, nextCommand, statusCommand } from '../commands/changes.js';
import { doctorCommand } from '../commands/doctor.js';
import { healthCommand } from '../commands/health.js';
import { approvalsVerify } from '../commands/approvals.js';
import { pluginBuildCommand } from '../commands/plugin.js';
import { approveCommand, rejectCommand, testsCommand, waiveCommand } from '../commands/gates.js';
import { releaseControlCommand, takeoverCommand } from '../commands/takeover.js';
import { answerCommand } from '../commands/answer.js';
import { reworkCommand } from '../commands/rework.js';
import { initCommand, uninstallCommand, updateCommand } from '../commands/setup.js';
import { reviewCommand, verifyCommand } from '../commands/verify.js';
import { runOpenSpec } from '../core/openspec.js';
import { findProjectRoot } from '../core/project.js';
import { runHook } from '../hook.js';
import { LICENSE_TERMS, REQUIRED_NOTICE } from '../core/license.js';
import { reportCommand } from '../commands/report.js';
import { layoutCommand } from '../commands/layout.js';
import { deferAdd, deferClose, deferList } from '../commands/defer.js';
import { trackSetCommand } from '../commands/track.js';
import { exploreCommand, exploreListCommand } from '../commands/explore.js';
import { importBmadCommand } from '../commands/import.js';
import { backlogAdd, backlogClose, backlogEdit, backlogEpicAdd, backlogEpicEdit, backlogList, backlogMove, backlogNext, backlogStart, } from '../commands/backlog.js';
import { rolesCheck, rolesMigrate, rolesWho } from '../commands/roles.js';
import { teamAcceptCommand, teamCheckCommand, teamListCommand, teamSyncCommand } from '../commands/team.js';
import { adoptCommand } from '../commands/adopt.js';
import { traceCommand } from '../commands/trace.js';
import { mcpCheckCommand, mcpServeCommand } from '../commands/mcp.js';
import { inboxDoneCommand, inboxListCommand } from '../commands/inbox.js';
import { eventsFlushCommand, eventsListCommand } from '../commands/events.js';
import { deliverAfterCommand } from '../mcp/events.js';
import { nextMeCommand } from '../commands/next-me.js';
import { approvePreviewCommand } from '../commands/approve-preview.js';
import { releaseCheckCommand } from '../commands/release.js';
import { explainCommand } from '../commands/explain.js';
import { resolveLocale, setLocale, systemLocale, t } from '../core/i18n.js';
import { applyCommanderLocale, localizeDescriptions, peekLocaleFlag } from './commander-i18n.js';
import { loadConfig } from '../core/config.js';
import { projectPaths } from '../core/project.js';
import { recordInvocation } from '../core/human-command.js';
function cmdDesc(key) {
    return t(key);
}
function applyLocale(flag) {
    let configLocale;
    const projectRoot = findProjectRoot();
    if (projectRoot) {
        try {
            configLocale = loadConfig(projectPaths(projectRoot).sdlcConfig).locale;
        }
        catch {
            configLocale = undefined;
        }
    }
    setLocale(resolveLocale({
        flag,
        env: process.env,
        config: configLocale,
        system: systemLocale(),
    }));
}
function withLocaleOption(command) {
    if (!command.options.some((option) => option.long === '--locale')) {
        command.option('--locale <locale>', 'UI locale (en, ru)');
    }
    for (const child of command.commands)
        withLocaleOption(child);
}
export function buildProgram() {
    const program = new Command();
    program.option('--locale <locale>', 'UI locale (en, ru)');
    program.hook('preAction', (_thisCommand, actionCommand) => {
        const opts = actionCommand.optsWithGlobals();
        applyLocale(opts.locale);
    });
    applyCommanderLocale(program);
    program.command('adopt').description(cmdDesc('cmd.adopt'))
        .option('--apply', 'apply the adoption draft (human only)')
        .option('--json', 'output JSON')
        .action((opts) => adoptCommand(opts));
    const roles = program.command('roles').description(cmdDesc('cmd.roles'));
    roles.command('check').description(cmdDesc('cmd.roles.check'))
        .option('--change <id>', 'change id').option('--base <ref>', 'base ref').option('--json', 'output JSON')
        .action((opts) => rolesCheck(opts));
    roles.command('who <gate>').description(cmdDesc('cmd.roles.who'))
        .requiredOption('--change <id>', 'change id').option('--base <ref>', 'base ref').option('--json', 'output JSON')
        .action((gate, opts) => rolesWho(gate, opts));
    roles.command('migrate').description(cmdDesc('cmd.roles.migrate'))
        .option('--json', 'output JSON').action((opts) => rolesMigrate(opts));
    const team = program.command('team').description(cmdDesc('cmd.team'));
    team.command('sync').description(cmdDesc('cmd.team.sync'))
        .option('--json', 'output JSON').action((opts) => teamSyncCommand(opts));
    team.command('accept [role]').description(cmdDesc('cmd.team.accept'))
        .option('--skill <id>', 'accept a skill of the team registry, scripts included (human only)')
        .option('--json', 'output JSON').action((role, opts) => teamAcceptCommand(role, opts));
    team.command('list').description(cmdDesc('cmd.team.list'))
        .option('--json', 'output JSON').action((opts) => teamListCommand(opts));
    team.command('check').description(cmdDesc('cmd.team.check'))
        .option('--json', 'output JSON').action((opts) => teamCheckCommand(opts));
    const backlog = program.command('backlog').description(cmdDesc('cmd.backlog'));
    const epic = backlog.command('epic').description(cmdDesc('cmd.backlog.epic'));
    epic.command('add <title>').description(cmdDesc('cmd.backlog.epic.add'))
        .option('--goal <text>', 'goal of the epic')
        .option('--json', 'output JSON')
        .action((title, opts) => backlogEpicAdd(title, opts));
    epic.command('edit <E-id>').description(cmdDesc('cmd.backlog.epic.edit'))
        .option('--title <text>', 'replacement title')
        .option('--goal <text>', 'replacement goal of the epic')
        .option('--clear-goal', 'remove the goal of the epic')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogEpicEdit(id, opts));
    backlog.command('add <title>').description(cmdDesc('cmd.backlog.add'))
        .option('--epic <E-id>', 'parent epic id')
        .option('--kind <kind>', 'kind of change')
        .option('--risk <risk>', 'risk level')
        .option('--outcome <text>', 'desired outcome')
        .option('--accept <text>', 'acceptance criterion', (value, previous) => [...previous, value], [])
        .option('--depends <B-id>', 'backlog dependency id', (value, previous) => [...previous, value], [])
        .option('--source-type <type>', 'origin type')
        .option('--source-ref <ref>', 'origin reference')
        .option('--json', 'output JSON')
        .action((title, opts) => backlogAdd(title, opts));
    backlog.command('edit <B-id>').description(cmdDesc('cmd.backlog.edit'))
        .option('--title <text>', 'replacement title')
        .option('--outcome <text>', 'desired outcome')
        .option('--accept <text>', 'acceptance criterion', (value, previous) => [...previous, value], [])
        .option('--add-accept <text>', 'additional acceptance criterion', (value, previous) => [...previous, value], [])
        .option('--depends <B-id>', 'backlog dependency id', (value, previous) => [...previous, value], [])
        .option('--clear-depends', 'remove all backlog dependencies')
        .option('--kind <kind>', 'kind of change')
        .option('--risk <risk>', 'risk level')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogEdit(id, opts));
    backlog.command('list').description(cmdDesc('cmd.backlog.list'))
        .option('--epic <E-id>', 'filter by epic id')
        .option('--status <status>', 'filter by status')
        .option('--ready', 'show ready items')
        .option('--json', 'output JSON')
        .action(opts => backlogList(opts));
    backlog.command('next').description(cmdDesc('cmd.backlog.next'))
        .option('--json', 'output JSON')
        .action(opts => backlogNext(opts));
    backlog.command('start <B-id>').description(cmdDesc('cmd.backlog.start'))
        .option('--change <id>', 'change id')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogStart(id, opts));
    backlog.command('move <B-id>').description(cmdDesc('cmd.backlog.move'))
        .option('--top', 'move to the top')
        .option('--before <B-id>', 'place before this item')
        .option('--after <B-id>', 'place after this item')
        .option('--epic <E-id>', 'move into this epic')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogMove(id, opts));
    backlog.command('drop <B-id>').description(cmdDesc('cmd.backlog.drop'))
        .option('--note <text>', 'reason for dropping')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogClose(id, 'dropped', opts));
    backlog.command('done <B-id>').description(cmdDesc('cmd.backlog.done'))
        .option('--note <text>', 'completion note')
        .option('--json', 'output JSON')
        .action((id, opts) => backlogClose(id, 'done', opts));
    const defer = program.command('defer').description(cmdDesc('cmd.defer'));
    defer.command('add <title>').description(cmdDesc('cmd.defer.add'))
        .option('--why <text>', 'reason for deferring')
        .option('--change <id>', 'related change id')
        .option('--finding <F-id>', 'related finding id')
        .option('--revisit <text>', 'when to revisit')
        .option('--json', 'output JSON')
        .action((title, opts) => deferAdd(title, opts));
    defer.command('list').description(cmdDesc('cmd.defer.list'))
        .option('--open', 'show open items')
        .option('--change <id>', 'filter by change id')
        .option('--json', 'output JSON')
        .action((opts) => deferList(opts));
    defer.command('close <D-id>').description(cmdDesc('cmd.defer.close'))
        .option('--status <status>', 'resolution status')
        .option('--note <text>', 'resolution note')
        .option('--json', 'output JSON')
        .action((id, opts) => deferClose(id, opts));
    const layout = program.command('layout').description(cmdDesc('cmd.layout'));
    layout.command('check').description(cmdDesc('cmd.layout.check'))
        .option('--json', 'output JSON')
        .action((opts) => layoutCommand('check', opts));
    layout.command('scaffold').description(cmdDesc('cmd.layout.scaffold'))
        .option('--dry-run', 'show planned files')
        .option('--json', 'output JSON')
        .action((opts) => layoutCommand('scaffold', opts));
    layout.command('adapt').description(cmdDesc('cmd.layout.adapt'))
        .option('--dry-run', 'show planned files')
        .option('--json', 'output JSON')
        .action((opts) => layoutCommand('adapt', opts));
    layout.command('convert').description(cmdDesc('cmd.layout.convert'))
        .option('--apply', 'apply conversion')
        .option('--in-place', 'convert the current working copy')
        .option('--worktree <path>', 'new worktree path')
        .option('--branch <name>', 'new branch name')
        .option('--json', 'output JSON')
        .action((opts) => layoutCommand('convert', opts));
    program
        .name('sdlc')
        .description(cmdDesc('cmd.program'))
        .addHelpText('after', `\n${REQUIRED_NOTICE}\nLicense: ${LICENSE_TERMS}`)
        .enablePositionalOptions()
        .showHelpAfterError();
    program
        .command('init [path]')
        .description(cmdDesc('cmd.init'))
        .option('--tools <list>', 'claude,opencode,cursor,codex,qwen,gigacode (experimental) | all | none '
        + '(default: detected, else claude,opencode)')
        .option('--delivery <mode>', 'both | skills | commands')
        .option('--cli <command>', 'how agents invoke the CLI, e.g. "npx --no-install sdlc" for a project-local install')
        .option('--mode <mode>', 'enforcement mode: off | warn | block')
        .option('--no-hooks', 'do not install Claude Code hooks')
        .option('--opsx', "also install OpenSpec's own /opsx workflows for the same tools")
        .option('--statusline', 'install the Claude Code status line')
        .option('--mcp', 'register sdlc as an MCP server for the chosen tools (mcp.serve in openspec/sdlc.yaml)')
        .option('--language <language>', 'artifact language for a new OpenSpec config')
        .option('--force', 'overwrite generated files even if edited locally')
        .option('--layout <action>', 'AI-ready documents: scaffold | adapt | worktree | none (default: none)')
        .option('--worktree <path>', 'folder for the new AI-ready worktree (with --layout worktree)')
        .option('--git-init', 'run git init when the folder is not a git repository')
        .option('--json', 'output JSON')
        .action((path, opts) => initCommand(path, opts));
    program
        .command('update [path]')
        .description(cmdDesc('cmd.update'))
        .option('--tools <list>', 'change the configured tools '
        + '(claude,opencode,cursor,codex,qwen,gigacode (experimental) | all | none)')
        .option('--force', 'overwrite generated files even if edited locally')
        .option('--dry-run', 'show what would change')
        .option('--json', 'output JSON')
        .action((path, opts) => updateCommand(path, opts));
    program
        .command('uninstall [path]')
        .description(cmdDesc('cmd.uninstall'))
        .option('--force', 'also remove generated files that were edited locally')
        .option('--dry-run', 'show what would be removed')
        .option('--json', 'output JSON')
        .action((path, opts) => uninstallCommand(path, opts));
    program
        .command('new <name>')
        .description(cmdDesc('cmd.new'))
        .option('--kind <kind>', 'feature | bugfix | refactor | chore | docs | incident | security')
        .option('--risk <risk>', 'low | medium | high (high adds tech-lead approvals)')
        .option('--track <track>', 'full (all gates) | lite (starts at plan; intent and spec optional)')
        .option('--source-type <type>', 'idea | ticket | incident | alert | scan | review | exploration | other')
        .option('--source-ref <id>', 'external record id (Jira, incident, finding) for linkage')
        .option('--source-url <url>', 'link to the external record')
        .option('--skip-specs', 'no externally visible behavior changes (sets skip_specs in .openspec.yaml)')
        .option('--schema <name>', 'OpenSpec schema (default: sdlc.yaml schema)')
        .option('--description <text>', 'description for the change README')
        .option('--json', 'output JSON')
        .action((name, opts) => newCommand(name, opts));
    const explore = program.command('explore')
        .description(cmdDesc('cmd.explore'))
        .argument('[slug]', 'exploration note slug')
        .option('--json', 'output JSON')
        .action((slug, opts) => { if (slug)
        exploreCommand(slug, opts); });
    explore.command('list').description(cmdDesc('cmd.explore.list'))
        .option('--json', 'output JSON')
        .action((opts) => exploreListCommand(opts));
    program.command('import').description(cmdDesc('cmd.import'))
        .command('bmad <path>').description(cmdDesc('cmd.import.bmad'))
        .option('--change <id>', 'target change id')
        .option('--to-backlog', 'import as backlog items')
        .option('--kind <kind>', 'kind of change')
        .option('--risk <risk>', 'risk level')
        .option('--dry-run', 'preview import')
        .option('--json', 'output JSON')
        .action((input, opts) => importBmadCommand(input, opts));
    program
        .command('status')
        .description(cmdDesc('cmd.status'))
        .option('--change <id>', 'one change in detail')
        .option('--archived', 'include archived changes')
        .option('--markdown', 'markdown report (for pull requests and wikis)')
        .option('--json', 'output JSON')
        .action((opts) => statusCommand(opts));
    program
        .command('explain')
        .description(cmdDesc('cmd.explain'))
        .option('--change <id>', 'change id (defaults to the only active change)')
        .option('--json', 'output JSON')
        .action((opts) => explainCommand(opts));
    program.command('help [topic]').description(cmdDesc('cmd.help'))
        .option('--json', 'output JSON').action((topic, opts) => helpCommand(topic, opts));
    program.command('guide [topic] [step]').description(cmdDesc('cmd.guide'))
        .option('--json', 'output JSON').action((topic, step, opts) => guideCommand(topic, step, opts));
    program.command('statusline').description(cmdDesc('cmd.statusline'))
        .action(() => statuslineCommand());
    const mcp = program.command('mcp').description(cmdDesc('cmd.mcp'));
    mcp.command('serve').description(cmdDesc('cmd.mcp.serve'))
        .option('--project <path>', 'serve this sdlc project instead of the current folder (repeatable)', (value, previous) => [...previous, value], [])
        .action((opts) => mcpServeCommand(opts));
    mcp.command('check').description(cmdDesc('cmd.mcp.check'))
        .option('--json', 'output JSON')
        .action((opts) => mcpCheckCommand(opts));
    const inbox = program.command('inbox').description(cmdDesc('cmd.inbox'));
    inbox.command('list').description(cmdDesc('cmd.inbox.list'))
        .option('--json', 'output JSON')
        .action((opts) => inboxListCommand(opts));
    inbox.command('done <id>').description(cmdDesc('cmd.inbox.done'))
        .option('--json', 'output JSON')
        .action((id, opts) => inboxDoneCommand(id, opts));
    const events = program.command('events').description(cmdDesc('cmd.events'));
    events.command('list').description(cmdDesc('cmd.events.list'))
        .option('--json', 'output JSON')
        .action((opts) => eventsListCommand(opts));
    events.command('flush').description(cmdDesc('cmd.events.flush'))
        .option('--json', 'output JSON')
        .action((opts) => eventsFlushCommand(opts));
    const release = program.command('release').description(cmdDesc('cmd.release'));
    release.command('check').description(cmdDesc('cmd.release.check'))
        .option('--change <id>', 'change id (defaults to the only active change)')
        .option('--json', 'output JSON')
        .action((opts) => releaseCheckCommand(opts));
    program.command('track').description(cmdDesc('cmd.track'))
        .command('set <track>')
        .description(cmdDesc('cmd.track.set'))
        .requiredOption('--change <id>', 'change id')
        .option('--note <text>', 'reason for the change')
        .option('--json', 'output JSON')
        .action((track, opts) => trackSetCommand(track, opts));
    program
        .command('next')
        .description(cmdDesc('cmd.next'))
        .option('--change <id>', 'change id (defaults to the only active change)')
        .option('--me', 'what waits for me: the gates I may decide now, across every active change (read-only)')
        .option('--json', 'output JSON')
        .action((opts) => (opts.me ? nextMeCommand(opts) : nextCommand(opts)));
    program
        .command('instructions <artifact>')
        .description(cmdDesc('cmd.instructions'))
        .option('--change <id>', 'change id')
        .option('--json', 'output JSON')
        .action((artifact, opts) => instructionsCommand(artifact, opts));
    for (const [name, fn, desc] of [
        ['approve', approveCommand, cmdDesc('cmd.approve')],
        ['reject', rejectCommand, cmdDesc('cmd.reject')],
        ['waive', waiveCommand, cmdDesc('cmd.waive')],
    ]) {
        const decision = program
            .command(`${name} <gate>`)
            .description(desc)
            .option('--change <id>', 'change id')
            .option('--as <role>', 'role you approve as (e.g. product-owner, tech-lead, engineer, code-owner)')
            .option('--note <text>', 'reason or comment (required for reject and waive)')
            .option('--by <identity>', 'override the git identity recorded as the decider')
            .option('--json', 'output JSON');
        if (name === 'approve') {
            decision.option('--preview', 'show what would be approved and whether you may approve it, without approving');
        }
        decision.action((gate, opts) => (opts.preview ? approvePreviewCommand(gate, opts) : fn(gate, opts)));
    }
    program.command('answer').description(cmdDesc('cmd.answer'))
        .argument('[n]', 'number of the open question (see --list)')
        .option('--change <id>', 'change id')
        .option('--artifact <artifact>', 'artifact with the question: intent (default), proposal or design')
        .option('--text <answer>', 'the answer, written under the question and into the change record')
        .option('--list', 'list the open questions and their answers (writes nothing)')
        .option('--json', 'output JSON')
        .action((n, opts) => answerCommand(n, opts));
    program.command('takeover').description(cmdDesc('cmd.takeover'))
        .option('--change <id>', 'change id')
        .option('--note <text>', 'why you take the change over (required; the agent sees it)')
        .option('--json', 'output JSON')
        .action((opts) => takeoverCommand(opts));
    program.command('release-control').description(cmdDesc('cmd.release-control'))
        .option('--change <id>', 'change id')
        .option('--note <text>', 'hand-back note for the agent (required)')
        .option('--json', 'output JSON')
        .action((opts) => releaseControlCommand(opts));
    program
        .command('rework <gate>')
        .description(cmdDesc('cmd.rework'))
        .option('--change <id>', 'change id')
        .option('--reason <category>', 'why the change goes back: a category from rework.reasons in sdlc.yaml')
        .option('--note <text>', 'what has to change (required)')
        .option('--as <role>', 'role you send the change back as')
        .option('--reset', 'restore the planned files and the change folder from the gate checkpoint')
        .option('--json', 'output JSON')
        .action((gate, opts) => reworkCommand(gate, opts));
    program.command('approvals').description(cmdDesc('cmd.approvals'))
        .command('verify').description(cmdDesc('cmd.approvals.verify'))
        .option('--mode <mode>', 'off | warn | required')
        .option('--json', 'output JSON')
        .action((opts) => approvalsVerify(opts));
    program
        .command('tests <action>')
        .description(cmdDesc('cmd.tests'))
        .option('--change <id>', 'change id')
        .option('--json', 'output JSON')
        .action((action, opts) => testsCommand(action, opts));
    program
        .command('verify')
        .description(cmdDesc('cmd.verify'))
        .option('--change <id>', 'change id')
        .option('--only <names>', 'run only these checks (comma-separated; never passes the gate)')
        .option('--list', 'list the configured checks')
        .option('--check', 'report spec scenarios missing from the behavioral verification table')
        .option('--strict', 'with --check: exit non-zero when scenarios are uncovered')
        .option('--json', 'output JSON')
        .action((opts) => verifyCommand(opts));
    program
        .command('review <action>')
        .description(cmdDesc('cmd.review'))
        .option('--change <id>', 'change id')
        .option('--base <ref>', 'base ref for the diff (default: review.base or origin/HEAD)')
        .option('--json', 'output JSON')
        .action((action, opts) => reviewCommand(action, opts));
    program
        .command('validate')
        .description(cmdDesc('cmd.validate'))
        .option('--change <id>', 'change id')
        .option('--all', 'all active changes')
        .option('--json', 'output JSON')
        .action((opts) => validateCommand(opts));
    program
        .command('archive [change]')
        .description(cmdDesc('cmd.archive'))
        .option('-y, --yes', 'do not ask for confirmation')
        .option('--skip-specs', 'archive without touching specs (tooling/docs changes)')
        .option('--force', 'archive past unsatisfied gates (human only, needs --note)')
        .option('--note <text>', 'reason for --force')
        .option('--json', 'output JSON')
        .action((change, opts) => archiveCommand(change, opts));
    program
        .command('audit')
        .description(cmdDesc('cmd.audit'))
        .option('--change <id>', 'one change (active or archived)')
        .option('--export <dir>', 'write the evidence bundle for auditors into this new or empty folder')
        .option('--since <date>', 'period start')
        .option('--json', 'output JSON')
        .action((opts) => auditCommand(opts));
    program
        .command('changelog')
        .description(cmdDesc('cmd.changelog'))
        .option('--change <id>', 'one change (active or archived)')
        .option('--since <date>', 'archived changes from this date on (YYYY-MM-DD)')
        .option('--json', 'output JSON')
        .action((opts) => changelogCommand(opts));
    program
        .command('report')
        .description(cmdDesc('cmd.report'))
        .option('--format <format>', 'md | json | html', 'md')
        .option('--json', 'output JSON')
        .option('--since <date>', 'period start')
        .option('--change <id>', 'one change')
        .option('--out <file>', 'write report to file')
        .action((opts) => reportCommand(opts));
    program
        .command('dashboard')
        .description(cmdDesc('cmd.dashboard'))
        .option('--since <date>', 'period start')
        .option('--change <id>', 'one change')
        .option('--out <file>', 'write dashboard to file')
        .action((opts) => reportCommand({ ...opts, format: 'html' }));
    program
        .command('log')
        .description(cmdDesc('cmd.log'))
        .option('--change <id>', 'only entries for this change')
        .option('--limit <n>', 'show the last n entries (default 50)')
        .option('--json', 'output JSON')
        .action((opts) => logCommand(opts));
    program
        .command('license [action] [type]')
        .description(cmdDesc('cmd.license'))
        .option('--agreement <id>', 'commercial agreement id (with `set commercial`)')
        .option('--licensee <name>', 'licensee named in the commercial agreement')
        .option('--json', 'output JSON')
        .action((action, type, opts) => licenseCommand(action, type, opts));
    program
        .command('doctor')
        .description(cmdDesc('cmd.doctor'))
        .option('--json', 'output JSON')
        .action((opts) => doctorCommand(opts));
    program
        .command('health')
        .description(cmdDesc('cmd.health'))
        .option('--json', 'output JSON')
        .action((opts) => healthCommand(opts));
    program
        .command('plugin')
        .description(cmdDesc('cmd.plugin'))
        .command('build [dir]')
        .description(cmdDesc('cmd.plugin.build'))
        .option('--cli <command>', 'how the plugin invokes the CLI (default: sdlc)')
        .option('--marketplace', 'also write ../.claude-plugin/marketplace.json next to the plugin dir')
        .option('--force', 'write into a non-empty directory')
        .option('--json', 'output JSON')
        .action((dir, opts) => pluginBuildCommand(dir, opts));
    program
        .command('trace <change>')
        .description(cmdDesc('cmd.trace'))
        .option('--json', 'output JSON')
        .action((change, opts) => traceCommand(change, opts));
    program
        .command('hook <event>')
        .description(cmdDesc('cmd.hook'))
        .option('--agent <agent>', 'claude | opencode | cursor | codex | qwen | gigacode', 'claude')
        .action((event, opts) => runHook(event, opts.agent));
    program
        .command('openspec')
        .description(cmdDesc('cmd.openspec'))
        .helpOption(false)
        .allowUnknownOption()
        .passThroughOptions()
        .argument('[args...]')
        .action((args) => {
        const cwd = findProjectRoot() ?? process.cwd();
        const result = runOpenSpec(args, { cwd, inherit: true });
        process.exitCode = result.exitCode ?? 1;
    });
    withLocaleOption(program);
    localizeDescriptions(program);
    return program;
}
/**
 * Commands after which queued events are not sent (B45): a hook must stay fast, the MCP server's stdout is the
 * protocol, and `events flush` has just sent them.
 */
const NO_DELIVERY = ['hook', 'mcp serve', 'events flush'];
/** `mcp serve` for the `serve` subcommand of `mcp`. */
function commandPath(command) {
    const names = [];
    for (let at = command; at?.parent; at = at.parent)
        names.unshift(at.name());
    return names.join(' ');
}
async function deliverAfter(command) {
    if (NO_DELIVERY.includes(commandPath(command)))
        return;
    await deliverAfterCommand();
}
export async function run(argv) {
    recordInvocation(argv.slice(2));
    applyLocale(peekLocaleFlag(argv));
    const program = buildProgram();
    program.hook('postAction', (_program, actionCommand) => deliverAfter(actionCommand));
    await program.parseAsync(argv);
}
