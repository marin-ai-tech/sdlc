import { describe, expect, it } from 'vitest';
import { httpAddress, originAllowed, requireMcpToken, tokenMatches } from '../src/mcp/http.js';

/**
 * B100 hardening that the end-to-end test does not reach: the Origin check (DNS rebinding), the token compare, the
 * minimum token length and the `--http` address parser.
 */

describe('B100: the HTTP server hardening', () => {
  it('a browser Origin of another host or port is refused; no Origin and loopback aliases pass', () => {
    expect(originAllowed(undefined, '127.0.0.1', 8080)).toBe(true);
    expect(originAllowed('http://localhost:8080', '127.0.0.1', 8080)).toBe(true);
    expect(originAllowed('http://evil.example:8080', '127.0.0.1', 8080)).toBe(false);
    expect(originAllowed('http://127.0.0.1:9090', '127.0.0.1', 8080)).toBe(false);
    expect(originAllowed('not a url', '127.0.0.1', 8080)).toBe(false);
  });

  it('the token compare needs the exact token', () => {
    expect(tokenMatches('a-token-of-16-chars', 'a-token-of-16-chars')).toBe(true);
    expect(tokenMatches('a-token-of-16-charsX', 'a-token-of-16-chars')).toBe(false);
    expect(tokenMatches('', 'a-token-of-16-chars')).toBe(false);
  });

  it('negative: a token shorter than 16 characters is refused', () => {
    const before = process.env.SDLC_MCP_TOKEN;
    try {
      process.env.SDLC_MCP_TOKEN = 'short';
      expect(() => requireMcpToken()).toThrow();
      process.env.SDLC_MCP_TOKEN = 'long-enough-token-1';
      expect(requireMcpToken()).toBe('long-enough-token-1');
    } finally {
      if (before === undefined) delete process.env.SDLC_MCP_TOKEN;
      else process.env.SDLC_MCP_TOKEN = before;
    }
  });

  it('the address is host:port; anything else is refused', () => {
    expect(httpAddress('127.0.0.1:0')).toEqual({ host: '127.0.0.1', port: 0 });
    expect(httpAddress('[::1]:8080')).toEqual({ host: '::1', port: 8080 });
    for (const bad of ['8080', ':8080', '127.0.0.1:', '127.0.0.1:99999', '127.0.0.1:80a']) {
      expect(() => httpAddress(bad), bad).toThrow();
    }
  });
});
