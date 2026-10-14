import { describe, expect, it } from 'vitest';
import { assertNoSecretLiterals, type McpServer } from '../src/mcp/registry.js';

/**
 * A gap found while recording the course videos (0.20.2, lesson 10.5): `headers: { Authorization: "Bearer <token>" }`
 * with a token that matched no provider's format was accepted and written into the tools' MCP files. The value has a
 * space, so the `key = "value"` heuristic never ran on it. A credential written after an authorization scheme
 * (Bearer, Basic, Token, Bot) is a literal secret unless it is a `${VAR}` reference.
 */

function server(headers: Record<string, string>): McpServer {
  const jira = { name: 'jira', type: 'http', url: 'https://mcp.corp.example/jira', headers, stages: [] };
  return jira as unknown as McpServer;
}

/** The error code of the refusal, or undefined when the registry is accepted. */
function refusal(headers: Record<string, string>): string | undefined {
  try {
    assertNoSecretLiterals([server(headers)]);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('a literal credential after an authorization scheme', () => {
  it('is refused, whatever the token looks like', () => {
    for (const value of ['Bearer abcdefghijklmnopqrstuvwxyz123456', 'Bearer ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLE12',
      'Basic dXNlcjpwYXNzd29yZA==', 'token 0123456789abcdef0123', 'Bot 1234567890:AAE-example-bot-credential']) {
      expect(refusal({ Authorization: value }), value).toBe('mcp_secret_literal');
    }
  });

  it('negative: a reference, or a header that carries no credential, is accepted', () => {
    for (const headers of [{ Authorization: 'Bearer ${JIRA_TOKEN}' }, { Authorization: 'Basic ${JIRA_BASIC}' },
      { Accept: 'application/json' }, { 'X-Team': 'payments' }]) {
      expect(refusal(headers), JSON.stringify(headers)).toBeUndefined();
    }
  });
});
