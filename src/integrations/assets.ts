import * as path from 'node:path';
import { parse } from 'yaml';
import { SdlcError } from '../core/errors.js';
import { readText } from '../core/fs-utils.js';
import { harnessPackageDir } from '../core/openspec-schema.js';

/** Workflow ids in the order they are presented to people. */
export const WORKFLOW_IDS = [
  'help',
  'guide',
  'next',
  'status',
  'health',
  'adopt',
  'team',
  'backlog',
  'explore',
  'intent',
  'spec',
  'plan',
  'build',
  'verify',
  'review',
  'release',
  'archive',
  'triage',
] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const AGENT_IDS = ['verifier', 'reviewer', 'researcher', 'simplifier', 'health', 'advocate'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface WorkflowTemplate {
  id: WorkflowId;
  title: string;
  description: string;
  commandDescription: string;
  argumentHint?: string;
  whenToUse?: string;
  body: string;
}

export interface AgentTemplate {
  id: AgentId;
  name: string;
  description: string;
  tools: string[];
  readonly: boolean;
  body: string;
}

export function assetsDir(): string {
  return path.join(harnessPackageDir(), 'assets');
}

export function readAsset(...segments: string[]): string {
  const file = path.join(assetsDir(), ...segments);
  const text = readText(file);
  if (text === undefined) {
    throw new SdlcError(
      'missing_asset',
      { key: 'error.harness_asset_not_found_x', params: { file: file } },
      { key: 'fix.reinstall_the_harness_package' }
    );
  }
  return text.replace(/\r\n?/g, '\n');
}

export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text };
  const data = parse(match[1]) as Record<string, unknown> | null;
  return { data: data ?? {}, body: match[2].replace(/^\n+/, '') };
}

export function loadWorkflow(id: WorkflowId): WorkflowTemplate {
  const { data, body } = splitFrontmatter(readAsset('workflows', `${id}.md`));
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
  const description = str('description');
  if (!description) throw new SdlcError(
    'invalid_asset',
    { key: 'error.workflow_x_has_no_description', params: { id: id } }
  );
  return {
    id,
    title: str('title') ?? `SDLC: ${id}`,
    description,
    commandDescription: str('command-description') ?? description,
    ...(str('argument-hint') ? { argumentHint: str('argument-hint') } : {}),
    ...(str('when-to-use') ? { whenToUse: str('when-to-use') } : {}),
    body,
  };
}

export function loadAgent(id: AgentId): AgentTemplate {
  const { data, body } = splitFrontmatter(readAsset('agents', `${id}.md`));
  const name = typeof data.name === 'string' ? data.name : `sdlc-${id}`;
  return {
    id,
    name,
    description: String(data.description ?? ''),
    tools: Array.isArray(data.tools) ? data.tools.map(String) : ['read', 'grep', 'glob'],
    readonly: data.readonly !== false,
    body,
  };
}
