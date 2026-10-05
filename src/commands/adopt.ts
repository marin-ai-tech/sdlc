import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { analyzeAdoption, applyAdoption } from '../core/adopt.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';

interface Options { apply?: boolean; json?: boolean }

type Draft = ReturnType<typeof analyzeAdoption>;

const ROLES_MIGRATE = 'sdlc roles migrate';

function showRoles(draft: Draft): void {
  const proposal = draft.proposal.roles;
  if (proposal.skip) {
    line(t('adopt.legacyRoles', { command: ROLES_MIGRATE }));
    return;
  }
  line(t('adopt.roles', { path: proposal.path }));
  for (const [role, people] of Object.entries(proposal.roles)) {
    const holders = people.join(', ');
    const shown = proposal.to_check.includes(role) ? t('adopt.toCheck', { value: holders }) : holders;
    line(`  ${role}: ${shown}`);
  }
  for (const scoped of draft.owners_scoped) {
    line(t('adopt.ownerScoped', { owner: scoped.owner, patterns: scoped.patterns.join(', ') }));
  }
}

function showDraft(draft: Draft): void {
  line(t('adopt.heading'));
  line(t('adopt.stack', { value: draft.stack.map((entry) => entry.id).join(', ') || '-' }));
  line(t('adopt.ci', { value: draft.ci.join(', ') || '-' }));
  for (const command of draft.proposal.verify.commands) {
    line(t('adopt.verify', { value: command.run }));
  }
  for (const file of draft.proposal.enforcement.protected_paths) {
    line(t('adopt.protected', { value: file }));
  }
  for (const file of draft.proposal.enforcement.test_paths) {
    line(t('adopt.tests', { value: file }));
  }
  for (const person of draft.people) {
    line(t('adopt.person', { name: person.name, email: person.email }));
  }
  showRoles(draft);
  line(t('adopt.apply', { command: draft.apply }));
}

function showApplied(draft: Draft, written: boolean): void {
  line(t(written ? 'adopt.applied' : 'adopt.unchanged'));
  if (draft.proposal.roles.skip) {
    line(t('adopt.legacyRoles', { command: ROLES_MIGRATE }));
  }
}

export function adoptCommand(opts: Options): void {
  try {
    if (opts.apply && agentEnvironment()) {
      throw new SdlcError('agent_cannot_adopt', { key: 'error.agent_cannot_adopt' });
    }
    const ctx = loadProject();
    const draft = analyzeAdoption(ctx);
    if (opts.apply) {
      const written = applyAdoption(ctx, draft.proposal);
      if (opts.json) printJson({ applied: written, ...draft });
      else showApplied(draft, written);
    } else if (opts.json) {
      printJson(draft);
    } else {
      showDraft(draft);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}