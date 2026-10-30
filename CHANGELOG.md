# Changelog

## 0.1.2

Read files on the box, and a setup script for Grok Bot VMs.

- New MCP tools `box_list` and `box_read_file`, and CLI `grokbot box ls` / `grokbot box cat`. They read the box over SSH (read-only, 1 MiB cap). The path is sent on stdin, never through a remote shell. File contents carry an untrusted notice.
- New token scope `box:read`. Read-only tokens do not get it; stdio MCP and the local CLI do.
- `scripts/box-tailscale-setup.sh` runs on a Grok Bot VM (no root, systemd, or sshd). It installs Tailscale in userspace with Tailscale SSH and a restart hook, and prints the login URL. Safe to re-run.
- `boxUser` config / `GROKBOT_BOX_USER` (default `box`).
- `docs/box.md`, README, and AGENTS.md lead with Tailscale SSH. The per-agent key scripts are now documented for boxes with a regular sshd.

## 0.1.1

Fixes found by running against a live Grok Bot session.

- Transcripts come back oldest first. The backend returns newest first, which broke `--since` and made `wait_for_reply` return old replies.
- `send` / `send_to_bot` return a `messageId` that matches the user entry in `read`, so `wait_for_reply` with `since` catches replies that arrive before it starts.
- `read --limit N` over-fetches from the backend, so tool and status entries no longer crowd out chat messages.
- When the backend answers, `bots` lists only the bots it knows about. Deleted bots and bots from another account no longer show up and fail on send.
- When the backend has no transcript for a bot, `read` falls back to the copy cached on disk.
- Upgrade `zod` to 4.6 for GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized input).
- Drop the `prepare` script. The package ships prebuilt, and npm 12 warned about a blocked install script on every install.

## 0.1.0

First release.

- Live session: the Keychain key is cached and given a 30s timeout. The old 3s limit silently dropped the standalone transport to the local cache.
- HTTP MCP: sessions are bound to the token that opened them, unknown sessions get `404`, bodies are capped at 2 MiB, `/health` is minimal and `/status` needs a token.
- Bot allowlists use the exact bot that was checked, even when two bots share a name.
- Backend and Notch calls time out after 30s. CLI number options are validated. `tail` polls sequentially. Token names are unique among active tokens.
- `doctor` resolves the box with DNS instead of `getent`, which macOS lacks.
- CI on Node 22 and 24, a working Homebrew formula, and tap install docs.
