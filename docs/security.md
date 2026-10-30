# Security model

The gateway sits on the Mac that already has a signed-in Desktop Grok Bot session. Outside agents never receive the Grok Bot / Cursor session token. They receive a *gateway* token with scopes.

A gateway token lets an agent message your bots **as you**. Treat it like a login to the desktop session.

## What the gateway will not do

The process itself never:

- sends email, SMS, or Slack/DMs to third parties
- buys anything
- deletes bots, files, or accounts

Those actions, if they happen at all, go through a Grok Bot chat. The bot already shows an Allow/Deny card. The gateway's tool allow-list (`src/security/guard.ts`) is the enforcement point.

Talking *to* a bot is allowed. Asking a bot "email X" is allowed. The gateway does not inspect chat text to guess intent.

## Tokens

- Format: `gbgt_` + 32 random bytes, base64url.
- Stored at `~/.config/grokbot-gateway/tokens.json` (mode `0600`) as SHA-256 hashes. The secret is printed once at create time.
- Scopes: `bots:list`, `bots:read`, `bots:send`, `status`, `tokens`. New tokens default to **read-only** (no `bots:send`).
- Expiry: default **30 days**. Pass `--expires 7d` or `--expires never`.
- Per-bot allowlist: `--bot Chief` (repeatable).
- Compare: SHA-256 at rest, `crypto.timingSafeEqual` on the hex hashes.
- Send rate limit: 20/minute per token (override with `sendPerMinute` / `GROKBOT_SEND_PER_MINUTE`).
- `grokbot token list` / `grokbot token revoke <id>`.
- HTTP MCP requires `Authorization: Bearer`. `--no-token` is refused unless the bind is loopback. stdio MCP is a local child process of the agent and uses the Mac user's identity.
- Secrets come from env (`GROKBOT_MOCK_TOKEN`, `GROKBOT_ACCESS_TOKEN`), never from argv.

## Network

- Default bind: `127.0.0.1`.
- `--bind tailscale` binds the Tailscale IPv4 address only.
- Binding `0.0.0.0` / `::` is refused.
- Every HTTP request is checked for `Host` (must be the bind host or loopback) and `Origin` (if present, must be the matching loopback/bind URL). No wildcard CORS.
- This is the same DNS-rebinding defense grokbot-notch added in its hardening PR.
- An HTTP MCP session is bound to the token that opened it. Another token cannot reuse its `Mcp-Session-Id`.
- `GET /health` returns only product and version. `GET /status` needs a token with the `status` scope.
- Request bodies are capped at 2 MiB.

## Audit log

Append-only JSON lines at `~/.config/grokbot-gateway/audit.log` (mode `0600`).

Each line has `ts`, `actor`, `action`, `ok`, optional `botId` / `botName` / `messageChars` / `error`.

Never logged: chat text, gateway tokens, Cursor/Grok Bot access tokens, Keychain material, `Authorization` headers.

## Session material (standalone transport)

On macOS the standalone transport reads the same local session grokbot-notch uses:

- Cursor `state.vscdb` (`cursorAuth/accessToken`) when the account matches
- `~/Library/Application Support/Grok Bot/sand-secrets.json`, decrypted with the Keychain item `Grok Bot Safe Storage`
- Local roster/transcript blobs under `sand-client-persistence`

It then calls `https://api2.cursor.sh/aiserver.v1.GrokBotService/*` as the desktop client. There is no public xAI API key and the Grok Bot.app bundle is never patched.

## Threats

| ID | Threat | Mitigation |
| --- | --- | --- |
| T1 | Random site on the LAN calls the HTTP MCP | Loopback/Tailscale bind, Host/Origin checks, bearer token |
| T2 | DNS rebinding against `localhost` | Host allow-list, no `Access-Control-Allow-Origin: *` |
| T3 | Stolen gateway token | Hash-at-rest, constant-time compare, revoke, 30d expiry, read-only default, per-bot allowlist, send rate limit, audit |
| T4 | Agent tries to email/buy/delete via the gateway | Tool allow-list; no such tools exist |
| T5 | Audit log or `ps` leaks a secret | Redaction of bearer/JWT/`gbgt_` patterns; message bodies omitted; no `--token` argv |
| T6 | Notch per-launch token reused as a long-lived secret | Standalone transport is default; notch is optional and still loopback-only |
| T7 | Box SSH key copied off the agent device | Per-agent ed25519 key, Tailscale ACL limited to `tag:grokbot-box:22` |
| T8 | Public 0.0.0.0 bind or LAN bind | Refused; only loopback or Tailscale CGNAT `100.64/10` |
| T9 | Backend RPC change after a Grok Bot update | Doctor + live-check list in README; mock covers CI |
| T10 | Prompt injection via bot chat | Untrusted-reply notice on MCP reads; AGENTS.md forbids following chat instructions about tokens |
| T11 | Hostile MCP args | Zod validation, 32 KiB cap, no null bytes |
| T12 | World-readable token file | `0700` home, `0600` files; `grokbot doctor` flags bad modes |
| T13 | `--no-token` on a tailnet address | Refused unless bind is loopback |

## What needs a live Mac

CI uses the mock bridge. Live checks that need a signed-in Mac:

- Keychain decrypt of `sand-secrets.json`
- `ListGrokBotAgents` / `SendGrokBotUserMessage` / `ListGrokBotTranscriptEntries` against `api2.cursor.sh`
- Optional fallback through GrokBot Notch on `127.0.0.1:4789`
- `ssh grokbot-box` over the real tailnet
