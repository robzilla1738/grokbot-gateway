# Box SSH over Tailscale

The Linux VM behind a Grok Bot is the **box**. On a typical tailnet it is reachable as host `grokbot-box` (or `<host>.<tailnet>.ts.net`). Outside agents should SSH there directly. The gateway does not proxy a shell.

## Grok Bot VMs (no systemd, no sshd)

A desktop Grok Bot's VM is a container. PID 1 is the Grok Bot pod daemon, so there is no systemd, no cron and no sshd. Install Tailscale in userspace as `box` and use Tailscale SSH instead of an SSH server. Ask a bot to run these (it shows Allow/Deny cards):

```sh
mkdir -p ~/.local/tailscale ~/.local/share/tailscale
# Tarball name for this arch: curl -fsSL 'https://pkgs.tailscale.com/stable/?mode=json' (Tarballs field)
curl -fsSL https://pkgs.tailscale.com/stable/<tarball> | tar xz -C ~/.local/tailscale --strip-components=1
nohup ~/.local/tailscale/tailscaled --tun=userspace-networking \
  --statedir=$HOME/.local/share/tailscale \
  --socket=$HOME/.local/share/tailscale/tailscaled.sock \
  > ~/.local/share/tailscale/tailscaled.log 2>&1 &
~/.local/tailscale/tailscale --socket=$HOME/.local/share/tailscale/tailscaled.sock up --ssh --hostname=grokbot-box
```

Open the printed login URL and approve the device. If an old offline `grokbot-box` is still on the tailnet, remove it first or the new one becomes `grokbot-box-1`.

Nothing restarts `tailscaled` after the VM restarts. Add a small `~/.local/bin/grokbot-tailscale-ensure` that starts `tailscaled` (same flags) when `pgrep -u "$(id -u)" -x tailscaled` finds nothing, and call it from the top of `~/.bashrc`. Login state lives in `~/.local/share/tailscale`, so it rejoins without another login.

Then connect from any tailnet device with no key setup:

```fish
ssh box@grokbot-box
```

The default tailnet policy uses Tailscale SSH `check` mode, which asks for a browser login every 12 hours or so. Switch the `ssh` rule to `"action": "accept"` if agents need to connect without that check.

## One-time on a device that can already log into the box (sshd boxes)

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
ssh box@grokbot-box "{ grep -v ' grokbot-gateway-claude-code\$' ~/.ssh/authorized_keys || true; } > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys"
grokbot token revoke claude-code   # if you also issued an HTTP MCP token
```
