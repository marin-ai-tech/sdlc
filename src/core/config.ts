import { SdlcError } from './errors.js';
import { isFile } from './fs-utils.js';
import { readYamlObject, writeYaml } from './yaml-io.js';

export const APPROVAL_GATES = ['intent', 'spec', 'plan', 'review', 'release'] as const;
export type ApprovalGateId = (typeof APPROVAL_GATES)[number];
export const ALL_GATES = ['intent', 'spec', 'plan', 'verify', 'review', 'release'] as const;
export type GateId = (typeof ALL_GATES)[number];

export type EnforcementMode = 'off' | 'warn' | 'block';
export type Delivery = 'both' | 'skills' | 'commands';

/** scdl is dual-licensed; a project declares which license it uses scdl under (see LICENSE). */
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
  /** How agents and hooks invoke the harness CLI: `sdlc`, or e.g. `npx sdlc` for a project-local install. */
  cli: string;
  tools: string[];
  delivery: Delivery;
  gates: Record<ApprovalGateId, GateConfig> & { verify: { required: boolean } };
  /** role -> people (emails or names) allowed to act in that role. */
  roles: Record<string, string[]>;
  verify: {
    commands: VerifyCommand[];
    timeoutSeconds: number;
    outputLines: number;
  };
  review: {
    policy: string;
    base?: string;
    blockOn: string[];
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
    testPaths: string[];
    forbidAgentApprovals: boolean;
    sessionContext: boolean;
    verifyBeforeStop: boolean;
  };
  /** The license this project uses scdl under; recorded in every log entry and lifecycle record. */
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

export function defaultConfig(): SdlcConfig {
  return {
    version: 1,
    schema: 'sdlc',
    cli: 'sdlc',
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
    review: { policy: 'REVIEW.md', blockOn: ['important'] },
    release: { commands: [...DEFAULT_RELEASE_COMMANDS] },
    enforcement: {
      mode: 'warn',
      requireApprovedPlan: true,
      exemptPaths: [...DEFAULT_EXEMPT_PATHS],
      protectedPaths: [],
      testPaths: [...DEFAULT_TEST_PATHS],
      forbidAgentApprovals: true,
      sessionContext: true,
      verifyBeforeStop: false,
    },
    license: { type: 'community' },
    log: { enabled: true, hookDecisions: true },
  };
}

type Raw = Record<string, unknown>;

function asObject(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SdlcError('invalid_config', `${where} must be a mapping.`);
  }
  return value as Raw;
}

function asStringArray(value: unknown, where: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new SdlcError('invalid_config', `${where} must be a list of strings.`);
  }
  return value as string[];
}

function asBool(value: unknown, where: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new SdlcError('invalid_config', `${where} must be true or false.`);
  return value;
}

function asNumber(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new SdlcError('invalid_config', `${where} must be a positive number.`);
  }
  return value;
}

function asString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SdlcError('invalid_config', `${where} must be a non-empty string.`);
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
    throw new SdlcError('unsupported_config_version', `${where('version')} must be 1.`);
  }
  config.schema = asString(raw.schema, where('schema')) ?? config.schema;
  config.cli = asString(raw.cli, where('cli')) ?? config.cli;
  if (!/^[A-Za-z0-9@._/ -]+$/.test(config.cli)) {
    throw new SdlcError('invalid_config', `${where('cli')} may only contain letters, digits, spaces and . _ / @ -`);
  }
  config.tools = asStringArray(raw.tools, where('tools')) ?? config.tools;
  const delivery = asString(raw.delivery, where('delivery'));
  if (delivery !== undefined) {
    if (delivery !== 'both' && delivery !== 'skills' && delivery !== 'commands') {
      throw new SdlcError('invalid_config', `${where('delivery')} must be both, skills, or commands.`);
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
          `${where(`gates.${id}`)} is not a known gate (${ALL_GATES.join(', ')}).`
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
    if (verify.commands !== undefined && verify.commands !== null) {
      if (!Array.isArray(verify.commands)) {
        throw new SdlcError('invalid_config', `${where('verify.commands')} must be a list.`);
      }
      config.verify.commands = verify.commands.map((entry, index) => {
        const key = `verify.commands[${index}]`;
        if (typeof entry === 'string') {
          return { name: entry.split(/\s+/)[0] ?? `check-${index + 1}`, run: entry, required: true };
        }
        const item = asObject(entry, where(key));
        const run = asString(item?.run, where(`${key}.run`));
        if (!run) throw new SdlcError('invalid_config', `${where(`${key}.run`)} is required.`);
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
  if (review) {
    config.review.policy = asString(review.policy, where('review.policy')) ?? config.review.policy;
    config.review.base = asString(review.base, where('review.base')) ?? config.review.base;
    config.review.blockOn = (asStringArray(review.block_on, where('review.block_on')) ?? config.review.blockOn)
      .map((s) => s.toLowerCase());
  }

  const release = asObject(raw.release, where('release'));
  if (release) {
    const commands = asStringArray(release.commands, where('release.commands'));
    if (commands) {
      for (const pattern of commands) {
        try {
          new RegExp(pattern, 'i');
        } catch {
          throw new SdlcError('invalid_config', `${where('release.commands')} has an invalid regular expression: ${pattern}`);
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
        throw new SdlcError('invalid_config', `${where('enforcement.mode')} must be off, warn, or block.`);
      }
      config.enforcement.mode = mode;
    }
    const e = config.enforcement;
    e.requireApprovedPlan =
      asBool(enforcement.require_approved_plan, where('enforcement.require_approved_plan')) ?? e.requireApprovedPlan;
    e.exemptPaths = asStringArray(enforcement.exempt_paths, where('enforcement.exempt_paths')) ?? e.exemptPaths;
    e.protectedPaths =
      asStringArray(enforcement.protected_paths, where('enforcement.protected_paths')) ?? e.protectedPaths;
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
        throw new SdlcError('invalid_config', `${where('license.type')} must be ${LICENSE_TYPES.join(' or ')}.`);
      }
      config.license.type = type as LicenseType;
    }
    for (const key of ['agreement', 'licensee'] as const) {
      const value = asString(license[key], where(`license.${key}`));
      if (value === undefined) continue;
      if (!LICENSE_FIELD.test(value)) {
        throw new SdlcError('invalid_config', `${where(`license.${key}`)} must be one line of at most 120 characters without | < >.`);
      }
      config.license[key] = value;
    }
  }

  const log = asObject(raw.log, where('log'));
  if (log) {
    config.log.enabled = asBool(log.enabled, where('log.enabled')) ?? config.log.enabled;
    config.log.hookDecisions = asBool(log.hook_decisions, where('log.hook_decisions')) ?? config.log.hookDecisions;
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
    };
  }
  gates.verify = { required: config.gates.verify.required };
  return {
    version: 1,
    schema: config.schema,
    cli: config.cli,
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
    },
    release: { commands: config.release.commands },
    enforcement: {
      mode: config.enforcement.mode,
      require_approved_plan: config.enforcement.requireApprovedPlan,
      exempt_paths: config.enforcement.exemptPaths,
      protected_paths: config.enforcement.protectedPaths,
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
  };
}

export const CONFIG_HEADER = `# SDLC harness configuration (https://github.com/marin-ai-tech/scdl)
# Lives next to OpenSpec's config.yaml; OpenSpec itself never reads this file.
# Gates follow Anthropic's AI-native SDLC playbook: intent -> spec -> plan -> verify -> review -> release.
# enforcement.mode: off | warn (remind, never block) | block (hooks deny actions that skip a gate).
# license.type: community (free: noncommercial use and open source projects) | commercial (paid, royalties).
# See LICENSE and COMMERCIAL-LICENSE.md in the scdl package; change it with \`sdlc license set\`.
`;

export function saveConfig(file: string, config: SdlcConfig): void {
  writeYaml(file, serializeConfig(config), CONFIG_HEADER);
}
