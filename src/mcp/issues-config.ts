import { SdlcError } from '../core/errors.js';

/**
 * The GitHub issues link (B93): `issues: { server, repo }` in `openspec/sdlc.yaml` names the registry server
 * (`mcp.servers`) that talks to the team's GitHub, and the repository (`owner/name`) whose issues the backlog
 * imports and closes. sdlc holds no token: the server does the talking, the way the `ci-green` check calls
 * `list_workflow_runs`. Parsed into types here; config.ts only calls `parseIssues`. An unknown server or a
 * repo that is not `owner/name` is an invalid configuration.
 */
export interface IssuesConfig {
  /** A name in `mcp.servers`. */
  server: string;
  /** Repository owner (`acme` of `acme/claims`). */
  owner: string;
  /** Repository name (`claims` of `acme/claims`). */
  repo: string;
}

const REPO = /^[^\s/]+\/[^\s/]+$/;

type Raw = Record<string, unknown>;

function invalid(key: string, where: string, extra: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}

function mapping(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where);
  return value as Raw;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('error.x_must_be_a_non_empty_string', where);
  return value;
}

/**
 * `issues`: the registry server and the repository, in the file's order; absent = the backlog is not linked
 * to GitHub issues. `servers` are the names of `mcp.servers`.
 */
export function parseIssues(
  value: unknown,
  where: (key: string) => string,
  servers: string[],
): IssuesConfig | undefined {
  const raw = mapping(value, where('issues'));
  if (!raw) return undefined;
  const server = text(raw.server, `${where('issues')}.server`);
  if (!servers.includes(server)) {
    throw invalid('error.events_unknown_server', `${where('issues')}.server`, { server });
  }
  const repo = text(raw.repo, `${where('issues')}.repo`);
  if (!REPO.test(repo)) throw invalid('error.x_must_be_x', `${where('issues')}.repo`, { p2: 'owner/name' });
  const [owner, name] = repo.split('/');
  return { server, owner, repo: name };
}
