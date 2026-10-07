import * as path from 'node:path';
import { loadConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { isFile } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { findProjectRoot, projectPaths } from '../core/project.js';
import { runCli } from './run-cli.js';
import { callTool, errorResult, type CliRunner, type ToolResult } from './call-tool.js';
import { findTool, READ_TOOLS, type ToolInputSchema } from './tools.js';

/**
 * `sdlc mcp serve --project <path>` (B46): one server for several sdlc projects, started from anywhere. With one
 * project the tools are exactly the ones of B13; with several, every tool takes a `project` argument (the project's
 * name) and `status` without it answers for every project, in the order given.
 */

export interface ServedProject {
  /** `project.name` in openspec/sdlc.yaml as people wrote it, else the folder name. */
  name: string;
  /** The project folder, absolute. */
  root: string;
}

export interface ListedTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

const PROJECT_ARGUMENT = 'project name: project.name in its openspec/sdlc.yaml, else its folder name';

/** One `--project` path: an sdlc project (it has openspec/sdlc.yaml), named by its config or its folder. */
export function servedProject(dir: string): ServedProject {
  const root = path.resolve(dir);
  const file = projectPaths(root).sdlcConfig;
  if (!isFile(file)) {
    throw new SdlcError(
      'not_an_sdlc_project',
      { key: 'error.mcp_project_x_is_not_an_sdlc_project', params: { path: root } },
      { key: 'fix.mcp_project_run_sdlc_init_there' },
    );
  }
  const name = loadConfig(file).project?.name ?? path.basename(root);
  return { name, root };
}

function assertUniqueNames(projects: readonly ServedProject[]): void {
  const seen = new Map<string, string>();
  for (const project of projects) {
    const first = seen.get(project.name);
    if (first !== undefined) {
      throw new SdlcError(
        'duplicate_project_name',
        { key: 'error.mcp_two_projects_are_named_x', params: { name: project.name, first, second: project.root } },
        { key: 'fix.mcp_give_one_a_project_name' },
      );
    }
    seen.set(project.name, project.root);
  }
}

/** The served projects: each `--project` in the order given, or the project of the folder the server starts in. */
export function resolveProjects(dirs: readonly string[], start: string = process.cwd()): ServedProject[] {
  if (dirs.length === 0) {
    const root = findProjectRoot(start) ?? path.resolve(start);
    return [{ name: path.basename(root), root }];
  }
  const projects = dirs.map((dir) => servedProject(dir));
  assertUniqueNames(projects);
  return projects;
}

function withProject(schema: ToolInputSchema): ToolInputSchema {
  const project = { type: 'string' as const, description: PROJECT_ARGUMENT };
  return { ...schema, properties: { ...schema.properties, project } };
}

/** tools/list: the B13 tools; with several projects each one also takes `project`. */
export function listedTools(projects: readonly ServedProject[]): ListedTool[] {
  const several = projects.length > 1;
  return READ_TOOLS.map(({ name, description, inputSchema }) => {
    return { name, description, inputSchema: several ? withProject(inputSchema) : inputSchema };
  });
}

interface SplitArguments {
  project?: string;
  rest: Record<string, unknown>;
}

/** The `project` argument apart from the tool's own ones, or the reason the arguments are refused. */
function splitProject(input: unknown): SplitArguments | string {
  const args = input === undefined || input === null ? {} : input;
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const { project, ...rest } = args as Record<string, unknown>;
  if (project === undefined || project === null) return { rest };
  if (typeof project !== 'string' || project.trim() === '') return 'project is not a valid value';
  return { project, rest };
}

function namesOf(projects: readonly ServedProject[]): string {
  return projects.map((project) => project.name).join(', ');
}

/** `status` for every project, in the order given: `{ projects: [{ project, status }] }`. */
async function statusOfAll(
  rest: Record<string, unknown>,
  projects: readonly ServedProject[],
  run: CliRunner,
): Promise<ToolResult> {
  const results = await Promise.all(projects.map((project) => callTool('status', rest, project.root, run)));
  const list = projects.map((project, i) => ({ project: project.name, status: results[i].structuredContent }));
  const json = { projects: list };
  const result: ToolResult = { content: [{ type: 'text', text: JSON.stringify(json) }], structuredContent: json };
  return results.some((r) => r.isError) ? { ...result, isError: true } : result;
}

/** A tool call with several projects: `status` alone answers for all; every other tool needs `project`. */
async function callWithoutProject(
  name: string,
  rest: Record<string, unknown>,
  projects: readonly ServedProject[],
  run: CliRunner,
): Promise<ToolResult> {
  if (name === 'status') return statusOfAll(rest, projects, run);
  const message = t('mcp.projectRequired', { tool: name, projects: namesOf(projects) }, 'en');
  return errorResult('project_required', message);
}

/** tools/call over the served projects: one project as in B13, several by the `project` argument. */
export async function callProjectTool(
  name: string,
  input: unknown,
  projects: readonly ServedProject[],
  run: CliRunner = runCli,
): Promise<ToolResult> {
  if (projects.length === 1) return callTool(name, input, projects[0].root, run);
  if (!findTool(name)) return errorResult('unknown_tool', `unknown tool: ${name}`);
  const split = splitProject(input);
  if (typeof split === 'string') return errorResult('invalid_arguments', `${name}: ${split}`);
  if (split.project === undefined) return callWithoutProject(name, split.rest, projects, run);
  const target = projects.find((project) => project.name === split.project);
  if (!target) {
    const message = t('mcp.unknownProject', { project: split.project, projects: namesOf(projects) }, 'en');
    return errorResult('unknown_project', message);
  }
  return callTool(name, split.rest, target.root, run);
}
