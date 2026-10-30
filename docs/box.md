# Box SSH over Tailscale

The Linux VM behind a Grok Bot is the **box**. On a typical tailnet it is reachable as host `grokbot-box` (or `<host>.<tailnet>.ts.net`). Outside agents should SSH there directly. The gateway does not proxy a shell.

## One-time on a device that can already log into the box

```fish
./scripts/box-ssh-setup.sh
```

That writes `~/.config/grokbot-gateway/ssh/local_ed25519` and prints the `~/.ssh/config` snippet.

## Per outside agent

On the agent's machine (after Tailscale is up):

```fish
./scripts/box-ssh-add-agent.sh claude-code
```

That:

1. Mints `~/.config/grokbot-gateway/ssh/claude-code_ed25519`
2. Appends the public key to `box@grokbot-box:~/.ssh/authorized_keys`
3. Prints a Tailscale ACL snippet that only allows `tag:outside-agent` → `tag:grokbot-box:22`

Copy the private key onto the agent device only. Do not put it in this repo.

Override user/host with `GROKBOT_BOX_USER` and `GROKBOT_BOX_HOST`.

## Tailscale ACL (example)

Merge; do not replace an existing policy blindly. If the file still has the default allow-all rule, `tag:outside-agent` can reach every device until you remove that rule.

```hujson
{
  "tagOwners": {
    "tag:grokbot-box": ["autogroup:admin"],
    "tag:outside-agent": ["autogroup:admin"],
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:outside-agent"],
      "dst": ["tag:grokbot-box:22"],
    },
  ],
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:outside-agent"],
      "dst": ["tag:grokbot-box"],
      "users": ["box"],
    },
  ],
}
```

Tag the box `tag:grokbot-box` and the agent device `tag:outside-agent`. Approve both in the admin console if the tailnet requires it.

## How an agent should work

- Chat, setup, and "please do X with approval" → `grokbot` CLI or MCP (`ask_bot` / `send_to_bot`).
- Files, processes, and packages **on the box** → `ssh grokbot-box`.
- Do not expose the box's own gateway port (`1340`) on the public internet. SSH (or a Tailscale serve on that host) is the path.

## Revoke

```fish
ssh box@grokbot-box "grep -v grokbot-gateway-claude-code ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp; mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys"
grokbot token revoke claude-code   # if you also issued an HTTP MCP token
```
