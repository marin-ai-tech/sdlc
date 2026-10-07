import { parseMinApprovals } from './approval-quorum.js';
import { SdlcError } from './errors.js';
import { isFile } from './fs-utils.js';
import { LAYOUT_ROLE_IDS, type LayoutMapping, type LayoutRoleId } from './layout.js';
import { parseMcpChecks, parseMcpServers, type McpCheck, type McpServer } from '../mcp/registry.js';
import { parseStages, type StagesConfig } from './stage-config.js';
import { readYamlObject } from './yaml-io.js';
import { updateYamlFile } from './yaml-update.js';

export const APPROVAL_GATES = ['intent', 'spec', 'plan', 'review', 'release'] as const;
export type ApprovalGateId = (typeof APPROVAL_GATES)[number];
export const ALL_GATES = ['intent', 'spec', 'plan', 'verify', 'review', 'release'] as const;
export type GateId = (typeof ALL_GATES)[number];

export type EnforcementMode = 'off' | 'warn' | 'block';
export type Delivery = 'both' | 'skills' | 'commands';

/** sdlc is dual-licensed; a project declares which license it uses sdlc under (see LICENSE). */
export const LICENSE_TYPES = ['community', 'commercial'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];
/**
 * Agreement ids and licensee names end up inside one-line provenance
 * comments, so they are kept to one line without `|`, `<` or `>`.
 */
export const LICENSE_FIELD = /^[^|<>\r\n]{1,120}$/;

export interface GateConfig {
  /** A gate that is not required never blocks progress; its approvals are still recorded. */
  required: boolean;
  /** Roles whose members may approve. Empty = anyone with a git identity. */
  approvers: string[];
  /** Additional roles that must approve when the change is marked `risk: high`. */
  highRiskApprovers: string[];
  /**
   * Schema artifact ids this gate covers. Unset = the built-in mapping
   * (intent -> intent; plan, tasks -> plan; every other planning artifact -> spec).
   */
  artifacts?: string[];
  /** Different people who must approve (`min_approvals`, an integer of 1 or more). Unset = 1. */
  minApprovals?: number;
}

export interface VerifyCommand {
  name: string;
  run: string;
  timeoutSeconds?: number;
  /** Optional commands record evidence but do not fail the verify gate. */
  required: boolean;
}

export interface SdlcConfig {
  version: 1;
  /** OpenSpec schema used for new changes created by `sdlc new`. */
  schema: string;
  /** How agents and hooks invoke the harness CLI: `sdlc`, or e.g. `npx --no-install sdlc` for a project-local install. */
  cli: string;
  statusline: boolean;
  tools: string[];
  delivery: Delivery;
  gates: Record<ApprovalGateId, GateConfig> & { verify: { required: boolean } };
  /** role -> people (emails or names) allowed to act in that role. */
  roles: Record<string, string[]>;
  verify: {
    commands: VerifyCommand[];
    timeoutSeconds: number;
    outputLines: number;
    /** MCP checks the CLI calls during `sdlc verify` (B12); absent when sdlc.yaml has none. */
    mcp?: McpCheck[];
  };
  review: {
    policy: string;
    base?: string;
    blockOn: string[];
    passes: string[];
    lenses: string[];
    requireLensCoverage: boolean;
  };
  release: {
    /** Regular expressions; a matching agent shell command needs release authorization. */
    commands: string[];
  };
  enforcement: {
    mode: EnforcementMode;
    requireApprovedPlan: boolean;
    exemptPaths: string[];
    protectedPaths: string[];
    /** Globs (root-relative) where the secret rule allows keys and tokens: test data (B16). */
    secretAllow: string[];
    testPaths: string[];
    forbidAgentApprovals: boolean;
    sessionContext: boolean;
    verifyBeforeStop: boolean;
  };
  /** The license this project uses sdlc under; recorded in every log entry and lifecycle record. */
  license: {
    type: LicenseType;
    /** Commercial agreement id. */
    agreement?: string;
    /** Licensee named in the commercial agreement. */
    licensee?: string;
  };
  /** Append-only project log (`openspec/.sdlc/log.jsonl`). */
  log: {
    enabled: boolean;
    /** Also log hook decisions that deny or warn. */
    hookDecisions: boolean;
  };
  /**
   * AI-ready layout: role id -> the project's actual path for that role, when
   * it differs from the canonical one (`sdlc layout adapt`). Empty = canonical.
   */
  layout: LayoutMapping;
  /** Reason categories `sdlc rework --reason` accepts. */
  rework: { reasons: string[] };
  /** UI locale (en, ru). Optional; absent means resolve from flag/env/system. */
  locale?: string;
  /**
   * MCP (B13): `serve` registers `sdlc mcp serve` for the configured tools. Absent when sdlc.yaml has no `mcp`
   * block. `servers` is the team's registry (B10), laid out for the tools; it is never written back, so the file
   * keeps it as people wrote it.
   */
  mcp?: { serve: boolean; servers?: McpServer[] };
  /** Skills and subagents per stage (B14); never written back, so the file keeps it as people wrote it. */
  stages: StagesConfig;
}

export const DEFAULT_TEST_PATHS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/test_*.py',
  '**/*_test.py',
  '**/*_test.go',
];

export const DEFAULT_EXEMPT_PATHS = [
  'openspec/**',
  '**/*.md',
  '.claude/**',
  '.opencode/**',
  'evals/**',
];

export const DEFAULT_RELEASE_COMMANDS = [
  '\\bdeploy\\b.*\\bprod(uction)?\\b',
  '\\bkubectl\\b.*\\b(apply|rollout|delete)\\b.*\\bprod(uction)?\\b',
  '\\bterraform\\s+apply\\b.*\\bprod(uction)?\\b',
  '\\bhelm\\s+(upgrade|install)\\b.*\\bprod(uction)?\\b',
];

export const DEFAULT_REWORK_REASONS = [
  'missing-requirement', 'wrong-assumption', 'design-flaw', 'implementation-bug', 'test-gap', 'scope-change',
  'other',
];

export function defaultConfig(): SdlcConfig {
  return {
    version: 1,
    schema: 'sdlc',
    cli: 'sdlc',
    statusline: false,
    tools: [],
    delivery: 'both',
    gates: {
      intent: { required: true, approvers: ['product-owner'], highRiskApprovers: [] },
      spec: { required: true, approvers: ['product-owner'], highRiskApprovers: ['tech-lead'] },
      plan: { required: true, approvers: ['engineer'], highRiskApprovers: ['tech-lead'] },
      verify: { required: true },
      review: { required: true, approvers: ['code-owner'], highRiskApprovers: [] },
      release: { required: false, approvers: ['release-manager'], highRiskApprovers: [] },
    },
    roles: {},
    verify: { commands: [], timeoutSeconds: 900, outputLines: 40 },
    review: { policy: 'REVIEW.md', blockOn: ['important'], passes: ['bugs', 'security', 'compliance'], lenses: ['adversarial', 'edge-cases', 'verification-gaps'], requireLensCoverage: true },
    release: { commands: [...DEFAULT_RELEASE_COMMANDS] },
    enforcement: {
      mode: 'warn',
      requireApprovedPlan: true,
      exemptPaths: [...DEFAULT_EXEMPT_PATHS],
      protectedPaths: [],
      secretAllow: [],
      testPaths: [...DEFAULT_TEST_PATHS],
      forbidAgentApprovals: true,
      sessionContext: true,
      verifyBeforeStop: false,
    },
    license: { type: 'community' },
    log: { enabled: true, hookDecisions: true },
    layout: {},
    rework: { reasons: [...DEFAULT_REWORK_REASONS] },
    stages: {},
  };
}

type Raw = Record<string, unknown>;

function asObject(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_mapping', params: { where: where } });
  }
  return value as Raw;
}

function asStringArray(value: unknown, where: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_list_of_strings', params: { where: where } });
  }
  return value as string[];
}

function asBool(value: unknown, where: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new SdlcError(
    'invalid_config',
    { key: 'error.x_must_be_true_or_false', params: { where: where } }
  );
  return value;
}

function asNumber(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_positive_number', params: { where: where } });
  }
  return value;
}

function asString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_non_empty_string', params: { where: where } });
  }
  return value;
}

/**
 * Parses `openspec/sdlc.yaml` over the defaults. Every field is optional, so a
 * file holding only `version: 1` is a valid, fully-defaulted config.
 */
export function parseConfig(raw: Raw, file = 'openspec/sdlc.yaml'): SdlcConfig {
  const config = defaultConfig();
  const where = (key: string) => `${file}: ${key}`;

  if (raw.version !== undefined && raw.version !== 1) {
    throw new SdlcError('unsupported_config_version', { key: 'error.x_must_be_1', params: { p1: where('version') } });
  }
  config.schema = asString(raw.schema, where('schema')) ?? config.schema;
  config.cli = asString(raw.cli, where('cli')) ?? config.cli;
  config.statusline = asBool(raw.statusline, where('statusline')) ?? config.statusline;
  config.stages = parseStages(raw.stages, where);
  const mcp = asObject(raw.mcp, where('mcp'));
  if (mcp) {
    const serve = asBool(mcp.serve, where('mcp.serve')) ?? false;
    config.mcp = { serve, servers: parseMcpServers(mcp.servers, where) };
  }
  if (!/^[A-Za-z0-9@._/ -]+$/.test(config.cli)) {
    throw new SdlcError(
      'invalid_config',
      { key: 'error.x_may_only_contain_letters_digits_spaces_and', params: { p1: where('cli') } }
    );
  }
  config.tools = asStringArray(raw.tools, where('tools')) ?? config.tools;
  const delivery = asString(raw.delivery, where('delivery'));
  if (delivery !== undefined) {
    if (delivery !== 'both' && delivery !== 'skills' && delivery !== 'commands') {
      throw new SdlcError(
        'invalid_config',
        { key: 'error.x_must_be_both_skills_or_commands', params: { p1: where('delivery') } }
      );
    }
    config.delivery = delivery;
  }

  const gates = asObject(raw.gates, where('gates'));
  if (gates) {
    for (const [id, value] of Object.entries(gates)) {
      const gate = asObject(value, where(`gates.${id}`));
      if (!gate) continue;
      if (id === 'verify') {
        config.gates.verify.required = asBool(gate.required, where('gates.verify.required')) ?? true;
        continue;
      }
      if (!(APPROVAL_GATES as readonly string[]).includes(id)) {
        throw new SdlcError(
      'invalid_config',
      { key: 'error.x_is_not_a_known_gate_x', params: { p1: where(`gates.${id}`), p2: ALL_GATES.join(', ') } }
    );
      }
      const target = config.gates[id as ApprovalGateId];
      target.required = asBool(gate.required, where(`gates.${id}.required`)) ?? target.required;
      target.approvers = asStringArray(gate.approvers, where(`gates.${id}.approvers`)) ?? target.approvers;
      target.highRiskApprovers =
        asStringArray(gate.high_risk_approvers, where(`gates.${id}.high_risk_approvers`)) ??
        target.highRiskApprovers;
      const artifacts = asStringArray(gate.artifacts, where(`gates.${id}.artifacts`));
      if (artifacts) target.artifacts = artifacts;
      const minApprovals = parseMinApprovals(gate.min_approvals, where(`gates.${id}.min_approvals`));
      if (minApprovals) target.minApprovals = minApprovals;
    }
  }

  const roles = asObject(raw.roles, where('roles'));
  if (roles) {
    for (const [role, people] of Object.entries(roles)) {
      config.roles[role] = asStringArray(people, where(`roles.${role}`)) ?? [];
    }
  }

  const verify = asObject(raw.verify, where('verify'));
  if (verify) {
    config.verify.timeoutSeconds =
      asNumber(verify.timeout_seconds, where('verify.timeout_seconds')) ?? config.verify.timeoutSeconds;
    config.verify.outputLines =
      asNumber(verify.output_lines, where('verify.output_lines')) ?? config.verify.outputLines;
    const checks = parseMcpChecks(verify.mcp, where);
    if (checks.length > 0) config.verify.mcp = checks;
    if (verify.commands !== undefined && verify.commands !== null) {
      if (!Array.isArray(verify.commands)) {
        throw new SdlcError(
          'invalid_config',
          { key: 'error.x_must_be_a_list', params: { p1: where('verify.commands') } }
        );
      }
      config.verify.commands = verify.commands.map((entry, index) => {
        const key = `verify.commands[${index}]`;
        if (typeof entry === 'string') {
          return { name: entry.split(/\s+/)[0] ?? `check-${index + 1}`, run: entry, required: true };
        }
        const item = asObject(entry, where(key));
        const run = asString(item?.run, where(`${key}.run`));
        if (!run) throw new SdlcError(
          'invalid_config',
          { key: 'error.x_is_required', params: { p1: where(`${key}.run`) } }
        );
        return {
          name: asString(item?.name, where(`${key}.name`)) ?? `check-${index + 1}`,
          run,
          timeoutSeconds: asNumber(item?.timeout_seconds, where(`${key}.timeout_seconds`)),
          required: asBool(item?.required, where(`${key}.required`)) ?? true,
        };
      });
    }
  }

  const review = asObject(raw.review, where('review'));
  config.review.requireLensCoverage = false;
  if (review) {
    config.review.policy = asString(review.policy, where('review.policy')) ?? config.review.policy;
    config.review.base = asString(review.base, where('review.base')) ?? config.review.base;
    config.review.blockOn = (asStringArray(review.block_on, where('review.block_on')) ?? config.review.blockOn)
      .map((s) => s.toLowerCase());
    for (const key of ['passes', 'lenses'] as const) {
      const names = asStringArray(review[key], where(`review.${key}`));
      if (names) {
        if (names.some((name) => !/^[a-z]+(?:-[a-z]+)*$/.test(name))) throw new SdlcError(
          'invalid_config',
          { key: 'error.x_must_contain_kebab_case_names', params: { p1: where(`review.${key}`) } }
        );
        config.review[key] = names;
      }
    }
    config.review.requireLensCoverage = asBool(review.require_lens_coverage, where('review.require_lens_coverage')) ?? false;
  }

  const release = asObject(raw.release, where('release'));
  if (release) {
    const commands = asStringArray(release.commands, where('release.commands'));
    if (commands) {
      for (const pattern of commands) {
        try {
          new RegExp(pattern, 'i');
        } catch {
          throw new SdlcError(
      'invalid_config',
      { key: 'error.x_has_an_invalid_regular_expression_x', params: { p1: where('release.commands'), pattern: pattern } }
    );
        }
      }
      config.release.commands = commands;
    }
  }

  const enforcement = asObject(raw.enforcement, where('enforcement'));
  if (enforcement) {
    const mode = asString(enforcement.mode, where('enforcement.mode'));
    if (mode !== undefined) {
      if (mode !== 'off' && mode !== 'warn' && mode !== 'block') {
        throw new SdlcError(
          'invalid_config',
          { key: 'error.x_must_be_off_warn_or_block', params: { p1: where('enforcement.mode') } }
        );
      }
      config.enforcement.mode = mode;
    }
    const e = config.enforcement;
    e.requireApprovedPlan =
      asBool(enforcement.require_approved_plan, where('enforcement.require_approved_plan')) ?? e.requireApprovedPlan;
    e.exemptPaths = asStringArray(enforcement.exempt_paths, where('enforcement.exempt_paths')) ?? e.exemptPaths;
    e.protectedPaths =
      asStringArray(enforcement.protected_paths, where('enforcement.protected_paths')) ?? e.protectedPaths;
    e.secretAllow = asStringArray(enforcement.secret_allow, where('enforcement.secret_allow')) ?? e.secretAllow;
    e.testPaths = asStringArray(enforcement.test_paths, where('enforcement.test_paths')) ?? e.testPaths;
    e.forbidAgentApprovals =
      asBool(enforcement.forbid_agent_approvals, where('enforcement.forbid_agent_approvals')) ??
      e.forbidAgentApprovals;
    e.sessionContext = asBool(enforcement.session_context, where('enforcement.session_context')) ?? e.sessionContext;
    e.verifyBeforeStop =
      asBool(enforcement.verify_before_stop, where('enforcement.verify_before_stop')) ?? e.verifyBeforeStop;
  }

  const license = asObject(raw.license, where('license'));
  if (license) {
    const type = asString(license.type, where('license.type'));
    if (type !== undefined) {
      if (!(LICENSE_TYPES as readonly string[]).includes(type)) {
        throw new SdlcError(
          'invalid_config',
          { key: 'error.x_must_be_x', params: { p1: where('license.type'), p2: LICENSE_TYPES.join(' or ') } }
        );
      }
      config.license.type = type as LicenseType;
    }
    for (const key of ['agreement', 'licensee'] as const) {
      const value = asString(license[key], where(`license.${key}`));
      if (value === undefined) continue;
      if (!LICENSE_FIELD.test(value)) {
        throw new SdlcError(
      'invalid_config',
      { key: 'error.x_must_be_one_line_of_at_most_120_characters_wit_2', params: { p1: where(`license.${key}`) } }
    );
      }
      config.license[key] = value;
    }
  }

  const log = asObject(raw.log, where('log'));
  if (log) {
    config.log.enabled = asBool(log.enabled, where('log.enabled')) ?? config.log.enabled;
    config.log.hookDecisions = asBool(log.hook_decisions, where('log.hook_decisions')) ?? config.log.hookDecisions;
  }

  const rework = asObject(raw.rework, where('rework'));
  config.rework.reasons = asStringArray(rework?.reasons, where('rework.reasons')) ?? config.rework.reasons;

  const locale = asString(raw.locale, where('locale'));
  if (locale !== undefined) config.locale = locale;

  const layout = asObject(raw.layout, where('layout'));
  if (layout) for (const [key, value] of Object.entries(layout)) {
    if (!(LAYOUT_ROLE_IDS as readonly string[]).includes(key)) throw new SdlcError(
      'invalid_config',
      { key: 'error.x_is_not_a_known_layout_role', params: { p1: where(`layout.${key}`) } }
    );
    if (typeof value !== 'string' || !value.trim() || /^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value))
      throw new SdlcError(
        'invalid_config',
        { key: 'error.x_must_be_a_relative_project_path', params: { p1: where(`layout.${key}`) } }
      );
    const normalized = value.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) throw new SdlcError(
      'invalid_config',
      { key: 'error.x_must_stay_inside_the_project', params: { p1: where(`layout.${key}`) } }
    );
    config.layout[key as LayoutRoleId] = normalized;
  }
  return config;
}

export function loadConfig(file: string): SdlcConfig {
  if (!isFile(file)) return defaultConfig();
  return parseConfig(readYamlObject(file) ?? {}, file);
}

/** Serializes back to the snake_case on-disk form. */
export function serializeConfig(config: SdlcConfig): Record<string, unknown> {
  const gates: Record<string, unknown> = {};
  for (const id of APPROVAL_GATES) {
    const gate = config.gates[id];
    gates[id] = {
      required: gate.required,
      approvers: gate.approvers,
      ...(gate.highRiskApprovers.length > 0 ? { high_risk_approvers: gate.highRiskApprovers } : {}),
      ...(gate.artifacts ? { artifacts: gate.artifacts } : {}),
      ...(gate.minApprovals ? { min_approvals: gate.minApprovals } : {}),
    };
  }
  gates.verify = { required: config.gates.verify.required };
  return {
    version: 1,
    schema: config.schema,
    cli: config.cli,
    statusline: config.statusline,
    tools: config.tools,
    delivery: config.delivery,
    gates,
    roles: config.roles,
    verify: {
      commands: config.verify.commands.map((c) => ({
        name: c.name,
        run: c.run,
        ...(c.timeoutSeconds ? { timeout_seconds: c.timeoutSeconds } : {}),
        ...(c.required ? {} : { required: false }),
      })),
      timeout_seconds: config.verify.timeoutSeconds,
      output_lines: config.verify.outputLines,
    },
    review: {
      policy: config.review.policy,
      ...(config.review.base ? { base: config.review.base } : {}),
      block_on: config.review.blockOn,
      passes: config.review.passes,
      lenses: config.review.lenses,
      require_lens_coverage: config.review.requireLensCoverage,
    },
    release: { commands: config.release.commands },
    enforcement: {
      mode: config.enforcement.mode,
      require_approved_plan: config.enforcement.requireApprovedPlan,
      exempt_paths: config.enforcement.exemptPaths,
      protected_paths: config.enforcement.protectedPaths,
      secret_allow: config.enforcement.secretAllow,
      test_paths: config.enforcement.testPaths,
      forbid_agent_approvals: config.enforcement.forbidAgentApprovals,
      session_context: config.enforcement.sessionContext,
      verify_before_stop: config.enforcement.verifyBeforeStop,
    },
    license: {
      type: config.license.type,
      ...(config.license.agreement ? { agreement: config.license.agreement } : {}),
      ...(config.license.licensee ? { licensee: config.license.licensee } : {}),
    },
    log: { enabled: config.log.enabled, hook_decisions: config.log.hookDecisions },
    ...(Object.keys(config.layout).length ? { layout: config.layout } : {}),
    ...(config.rework.reasons.join() === DEFAULT_REWORK_REASONS.join() ? {} : { rework: config.rework }),
    ...(config.locale ? { locale: config.locale } : {}),
    ...(config.mcp ? { mcp: { serve: config.mcp.serve } } : {}),
  };
}

export const CONFIG_HEADER = `# SDLC harness configuration (https://github.com/marin-ai-tech/sdlc)
# Lives next to OpenSpec's config.yaml; OpenSpec itself never reads this file.
# Gates follow Anthropic's AI-native SDLC playbook: intent -> spec -> plan -> verify -> review -> release.
# enforcement.mode: off | warn (remind, never block) | block (hooks deny actions that skip a gate).
# license.type: community (free: noncommercial use and open source projects) | commercial (paid, royalties).
# See LICENSE and COMMERCIAL-LICENSE.md in the sdlc package; change it with \`sdlc license set\`.
`;

/** Writes only what changed, so comments and keys people added by hand stay (see `updateYamlFile`). */
export function saveConfig(file: string, config: SdlcConfig): void {
  let previous: Record<string, unknown> = {};
  try {
    previous = isFile(file) ? serializeConfig(loadConfig(file)) : {};
  } catch {
    previous = {};
  }
  updateYamlFile(file, previous, serializeConfig(config), CONFIG_HEADER);
}
