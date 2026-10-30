# Changelog

## 0.1.1

Fixes found by running against a live Grok Bot session.

- Transcripts come back oldest first. The backend returns newest first, which broke `--since` and made `wait_for_reply` return old replies.
- `send` / `send_to_bot` return a `messageId` that matches the user entry in `read`, so `wait_for_reply` with `since` catches replies that arrive before it starts.
- `read --limit N` over-fetches from the backend, so tool and status entries no longer crowd out chat messages.
- When the backend answers, `bots` lists only the bots it knows about. Deleted bots and bots from another account no longer show up and fail on send.
- When the backend has no transcript for a bot, `read` falls back to the copy cached on disk.

## 0.1.0

First release.

- Live session: the Keychain key is cached and given a 30s timeout. The old 3s limit silently dropped the standalone transport to the local cache.
- HTTP MCP: sessions are bound to the token that opened them, unknown sessions get `404`, bodies are capped at 2 MiB, `/health` is minimal and `/status` needs a token.
- Bot allowlists use the exact bot that was checked, even when two bots share a name.
- Backend and Notch calls time out after 30s. CLI number options are validated. `tail` polls sequentially. Token names are unique among active tokens.
- `doctor` resolves the box with DNS instead of `getent`, which macOS lacks.
- CI on Node 22 and 24, a working Homebrew formula, and tap install docs.
