import { SdlcError } from './errors.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readAsset } from '../integrations/assets.js';
import { isWithin, toPosix } from './fs-utils.js';
export const LAYOUT_ROLE_IDS = [
    'agents-guide',
    'claude-guide',
    'readme',
    'review-policy',
    'architecture',
    'conventions',
    'glossary',
    'runbook',
    'security',
    'decisions',
];
export const LAYOUT_ROLES = [
    {
        id: 'agents-guide',
        path: 'AGENTS.md',
        kind: 'file',
        required: true,
        template: 'ai-ready/AGENTS.md',
        aliases: ['AGENT.md'],
        purpose: 'Main guide for coding agents (read by OpenCode; imported by CLAUDE.md).',
    },
    {
        id: 'claude-guide',
        path: 'CLAUDE.md',
        kind: 'file',
        required: false,
        template: 'ai-ready/CLAUDE.md',
        aliases: ['.claude/CLAUDE.md'],
        purpose: 'Thin Claude Code entry point: imports AGENTS.md, adds Claude-only notes.',
    },
    {
        id: 'readme',
        path: 'README.md',
        kind: 'file',
        required: true,
        template: 'ai-ready/README.md',
        aliases: ['README', 'README.txt', 'README.rst'],
        purpose: 'What the project is and how a person starts with it.',
    },
    {
        id: 'review-policy',
        path: 'REVIEW.md',
        kind: 'file',
        required: false,
        template: 'REVIEW.md',
        aliases: ['docs/REVIEW.md', '.github/REVIEW.md'],
        purpose: 'Review passes and severities used by /sdlc:review.',
    },
    {
        id: 'architecture',
        path: 'docs/architecture.md',
        kind: 'file',
        required: true,
        template: 'ai-ready/docs/architecture.md',
        aliases: ['ARCHITECTURE.md', 'docs/ARCHITECTURE.md', 'doc/architecture.md', 'docs/architecture/README.md'],
        purpose: 'System map: modules, boundaries, data flows, external dependencies.',
    },
    {
        id: 'conventions',
        path: 'docs/conventions.md',
        kind: 'file',
        required: true,
        template: 'ai-ready/docs/conventions.md',
        aliases: ['CONVENTIONS.md', 'docs/CONVENTIONS.md', 'docs/coding-standards.md', 'docs/style-guide.md', 'STYLEGUIDE.md', 'CONTRIBUTING.md'],
        purpose: 'Code style, naming, error handling and testing rules.',
    },
    {
        id: 'glossary',
        path: 'docs/glossary.md',
        kind: 'file',
        required: false,
        template: 'ai-ready/docs/glossary.md',
        aliases: ['GLOSSARY.md', 'docs/GLOSSARY.md', 'docs/ubiquitous-language.md', 'docs/terminology.md'],
        purpose: 'Domain vocabulary shared by people, specs and code.',
    },
    {
        id: 'runbook',
        path: 'docs/runbook.md',
        kind: 'file',
        required: true,
        template: 'ai-ready/docs/runbook.md',
        aliases: ['RUNBOOK.md', 'docs/RUNBOOK.md', 'DEVELOPMENT.md', 'docs/development.md', 'docs/operations.md'],
        purpose: 'How to build, run, test and debug; environments and their commands.',
    },
    {
        id: 'security',
        path: 'docs/security.md',
        kind: 'file',
        required: false,
        template: 'ai-ready/docs/security.md',
        aliases: ['SECURITY.md', 'docs/SECURITY.md', 'docs/threat-model.md'],
        purpose: 'Threat model, sensitive zones and rules agents must not break.',
    },
    {
        id: 'decisions',
        path: 'docs/decisions/',
        kind: 'dir',
        required: false,
        template: 'ai-ready/docs/decisions/0001-record-architecture-decisions.md',
        aliases: ['docs/adr/', 'docs/adrs/', 'doc/adr/', 'adr/', 'docs/architecture/decisions/', 'decisions/'],
        purpose: 'Architecture decision records (ADR), one file per decision.',
    },
];
/**
 * Paths that other tools look for at a fixed place (GitHub renders README,
 * CONTRIBUTING and SECURITY; `.github/` is GitHub's). `layout convert` never
 * moves them; `layout adapt` may still map a role to them.
 */
export const PINNED_PATHS = ['README.md', 'README', 'README.txt', 'README.rst', 'CONTRIBUTING.md', 'SECURITY.md', '.github/'];
/** Paths `layout convert` never reads, rewrites or moves. */
export const CONVERT_EXCLUDES = ['openspec/', 'node_modules/', '.git/', 'dist/', 'build/', 'vendor/'];
export function layoutRole(id) {
    const role = LAYOUT_ROLES.find((r) => r.id === id);
    if (!role)
        throw new SdlcError('unknown_layout_role', { key: 'error.unknown_layout_role_x', params: { id: id } });
    return role;
}
function notImplemented(what) {
    throw new SdlcError('not_implemented', { key: 'error.x_is_not_implemented_yet', params: { what: what } });
}
/** Finds each role in `root`, honouring the `layout:` mapping. Read-only. */
export function detectLayout(root, mapping = {}) {
    const find = (candidate, kind) => {
        let current = root;
        const parts = candidate.replace(/\/$/, '').split('/');
        const actual = [];
        for (const part of parts) {
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            }
            catch {
                return undefined;
            }
            const entry = entries.find((e) => e.name === part) ?? entries.find((e) => e.name.toLowerCase() === part.toLowerCase());
            if (!entry)
                return undefined;
            actual.push(entry.name);
            current = path.join(current, entry.name);
        }
        const stat = fs.statSync(current);
        if (kind === 'file' ? !stat.isFile() : !stat.isDirectory())
            return undefined;
        return `${actual.join('/')}${kind === 'dir' ? '/' : ''}`;
    };
    const warnings = [];
    const roles = LAYOUT_ROLES.map((role) => {
        const mapped = mapping[role.id];
        const candidates = [];
        const paths = [...(mapped ? [mapped] : []), role.path, ...role.aliases];
        for (const candidate of paths) {
            const found = find(candidate, role.kind);
            if (found && !candidates.includes(found))
                candidates.push(found);
        }
        const mappedFound = mapped ? find(mapped, role.kind) : undefined;
        if (mapped && !mappedFound)
            warnings.push(`Mapped ${role.id} path is missing: ${mapped}`);
        if (mapped && !mappedFound)
            return { role: role.id, status: 'missing', candidates };
        const selected = candidates[0];
        return selected
            ? { role: role.id, status: mappedFound ? 'mapped' : selected === find(role.path, role.kind) ? 'canonical' : 'alias', path: selected, candidates }
            : { role: role.id, status: 'missing', candidates };
    });
    const missingRequired = roles.filter((r) => r.status === 'missing' && layoutRole(r.role).required).map((r) => r.role);
    return { roles, ready: missingRequired.length === 0, score: Math.round(roles.filter((r) => r.status !== 'missing').length / roles.length * 100), missingRequired, warnings };
}
/**
 * Replaces `{{project.name}}`, `{{cli}}`, `{{path:<role>}}` (a path relative to
 * the file being written, so links work from any folder) and
 * `{{verify.commands}}` (a Markdown bullet list, or a one-line hint when empty).
 * Unknown `{{…}}` tokens are an error, so a template can never ship a hole.
 */
export function renderLayoutTemplate(text, targetPath, ctx) {
    return text.replace(/\{\{([^{}]+)\}\}/g, (_match, token) => {
        if (token === 'project.name')
            return ctx.projectName;
        if (token === 'cli')
            return ctx.cli;
        if (token === 'verify.commands')
            return ctx.verifyCommands.length
                ? ctx.verifyCommands.map((c) => `- ${c.name}: \`${c.run}\``).join('\n')
                : 'Add verification commands to openspec/sdlc.yaml.';
        if (token.startsWith('path:')) {
            const id = token.slice(5);
            if (!LAYOUT_ROLE_IDS.includes(id))
                throw new SdlcError('unknown_layout_token', { key: 'error.unknown_layout_token_x', params: { token: token } });
            const destination = ctx.paths[id];
            const relative = path.posix.relative(path.posix.dirname(toPosix(targetPath)), destination.replace(/\/$/, ''));
            return relative + (destination.endsWith('/') ? '/' : '');
        }
        throw new SdlcError('unknown_layout_token', { key: 'error.unknown_layout_token_x', params: { token: token } });
    });
}
function writeMissing(root, config, opts, report) {
    const created = [];
    const kept = [];
    const paths = Object.fromEntries(LAYOUT_ROLES.map((role) => {
        const found = report.roles.find((r) => r.role === role.id);
        return [role.id, found.path ?? role.path];
    }));
    const ctx = { projectName: path.basename(root), paths, verifyCommands: config.verify.commands, cli: config.cli };
    for (const role of LAYOUT_ROLES) {
        const rel = role.kind === 'dir' ? role.path + path.posix.basename(role.template) : role.path;
        const target = path.resolve(root, rel);
        if (!isWithin(root, target))
            throw new SdlcError('invalid_config', { key: 'error.layout_target_outside_project_x', params: { rel: rel } });
        const found = report.roles.find((r) => r.role === role.id);
        if (found.status !== 'missing') {
            if (found.status === 'canonical')
                kept.push(rel);
            continue;
        }
        if (fs.existsSync(target)) {
            kept.push(rel);
            continue;
        }
        const content = renderLayoutTemplate(readAsset('project', role.template), rel, ctx);
        created.push(rel);
        if (!opts.dryRun) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
        }
    }
    return { created, kept };
}
/** Creates every missing role at its canonical path from its template. Never overwrites. */
export function scaffoldLayout(root, config, opts = {}) {
    return writeMissing(root, config, opts, detectLayout(root, config.layout));
}
/**
 * Adapts to the existing structure: records roles found at aliases in
 * `config.layout` (the caller saves the config), creates only the missing
 * roles at canonical paths, and renders AGENTS.md links to the real files.
 * Moves nothing.
 */
export function adaptLayout(root, config, opts = {}) {
    const report = detectLayout(root, config.layout);
    for (const found of report.roles) {
        if (found.status === 'alias' && found.path)
            config.layout[found.role] = found.path;
    }
    return { ...writeMissing(root, config, opts, detectLayout(root, config.layout)), mapping: { ...config.layout } };
}
/** Plans the moves to canonical paths. Read-only. */
export { planConversion } from './layout-convert.js';
/**
 * Applies a plan with `git mv`, rewrites relative Markdown links to moved
 * paths, and drops the moved roles from `config.layout` (the caller saves
 * the config). Refuses when the plan has conflicts or the worktree is dirty
 * (`dirty_worktree`).
 */
export { applyConversion } from './layout-convert.js';
