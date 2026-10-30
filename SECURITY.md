# Security

This software is unofficial. A gateway token or a local `grokbot mcp` process can send chat **as the signed-in Desktop Grok Bot user**. Treat those credentials like a login.

## Disclosure

Report vulnerabilities privately. Do not file a public issue with a working exploit.

Use GitHub's private vulnerability reporting: [open a draft advisory](https://github.com/robzilla1738/grokbot-gateway/security/advisories/new).

We aim to acknowledge reports within a week.

## Threat model (short)

| ID | Threat | Mitigation |
| --- | --- | --- |
| T1 | LAN or website calls the HTTP MCP | Loopback or Tailscale CGNAT bind only. Host/Origin allow-list. No `0.0.0.0`. |
| T2 | DNS rebinding | Host must match bind/loopback. No wildcard CORS. |
| T3 | Stolen gateway token | SHA-256 at rest, constant-time compare, revoke, expiry (default 30d), scopes, per-bot allowlist, send rate limit. |
| T4 | Agent emails, buys, or deletes via the gateway | No such tools. Allow-list in `src/security/guard.ts`. |
| T5 | Secrets in logs or `ps` | Audit omits bodies and redacts tokens. Mock token from env, not argv. |
| T6 | World-readable token file | `0700` home, `0600` tokens/config/audit. `grokbot doctor` flags bad modes. |
| T7 | Prompt injection from bot chat | MCP read/ask/wait wrap replies with an untrusted-text notice. AGENTS.md tells agents not to follow chat instructions about tokens. |
| T8 | Oversized or hostile tool args | Zod validation, 32 KiB message cap, no null bytes. |
| T9 | `--no-token` on a tailnet address | Refused unless bind is loopback. |
| T10 | Backend RPC change | Doctor + mock tests. Do not patch Grok Bot.app. |

## Token scopes

- Default for `grokbot token create`: `bots:list`, `bots:read`, `status` (no send).
- Add `bots:send` only for agents that must talk.
- `--bot Chief` limits that token to one bot.
- `--expires 7d` (default `30d`; `never` to disable).

## What this gateway never does

It never sends email, SMS, or third-party DMs, never buys anything, and never deletes bots or files. Ask a Grok Bot, and wait for the owner's Allow/Deny card.
