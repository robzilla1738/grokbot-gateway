# The box (Grok Bot's Linux VM)

The Linux VM behind a Grok Bot is the **box**. Outside agents reach it over your Tailscale tailnet as `grokbot-box` (or `<host>.<tailnet>.ts.net`):

- **Read files** with the MCP tools `box_list` / `box_read_file` or the CLI `grokbot box ls` / `grokbot box cat`. Read-only.
- **Everything else** (edit files, run commands): `ssh box@grokbot-box` directly, or ask the bot.

Both go over SSH from the Mac. The gateway never writes files or runs commands on the box.

## Set up the box (one time)

A desktop Grok Bot's VM is a container: no root, no systemd, no cron, no sshd. [`scripts/box-tailscale-setup.sh`](../scripts/box-tailscale-setup.sh) installs Tailscale in the box user's home, turns on Tailscale SSH (so no sshd and no keys), and adds a restart hook. Run it **on the box**. The easy way is to ask the bot, which shows Allow/Deny cards before it runs anything:

```fish
grokbot ask Chief --timeout 300 "Please download https://raw.githubusercontent.com/robzilla1738/grokbot-gateway/main/scripts/box-tailscale-setup.sh to /tmp, read it, then run it with sh and send me the login URL it prints."
```

Then:

1. Open the login URL it prints and approve the device on your tailnet.
2. If an old offline `grokbot-box` is still listed in the [Tailscale admin console](https://login.tailscale.com/admin/machines), remove it first. Otherwise the new one becomes `grokbot-box-1`.
3. From the Mac: `grokbot box ls` and `ssh box@grokbot-box`.

Use another hostname with `GROKBOT_BOX_HOST=<name> sh box-tailscale-setup.sh` on the box, and set `GROKBOT_BOX_HOST` (or `boxHost` in `config.json`) on the Mac to match. The box user defaults to `box` (`GROKBOT_BOX_USER` / `boxUser`).

The script is safe to re-run. It installs into `~/.local/tailscale`, keeps state in `~/.local/share/tailscale`, and adds `~/.local/bin/grokbot-tailscale-ensure`, which the top of `~/.bashrc` calls on every shell to restart `tailscaled` if it is not running. Login state survives restarts, so the box rejoins without another approval.

### If the box shows offline

Grok Bot VMs can pause while the bot is idle, and the userspace daemon sometimes loses its link to Tailscale's coordination server afterward. Message the bot (that wakes the VM) and ask it to run:

```sh
~/.local/bin/grokbot-tailscale-ensure --restart
```

### Tailscale SSH check mode

The default tailnet policy uses Tailscale SSH `check` mode, which asks for a browser login every 12 hours or so. When that happens, `box_list` / `box_read_file` return an error with the login URL; open it and retry. For unattended agents, change the `ssh` rule for the box to `"action": "accept"` (see the ACL below).

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

## Boxes with a regular sshd

If your box runs its own SSH server instead of Tailscale SSH, give each outside agent its own key.

One time, on a device that can already log into the box:

```fish
./scripts/box-ssh-setup.sh
```

That writes `~/.config/grokbot-gateway/ssh/local_ed25519` and prints the `~/.ssh/config` snippet.

Per outside agent, on the agent's machine (after Tailscale is up):

```fish
./scripts/box-ssh-add-agent.sh claude-code
```

That mints `~/.config/grokbot-gateway/ssh/claude-code_ed25519`, appends the public key to `box@grokbot-box:~/.ssh/authorized_keys`, and prints a Tailscale ACL snippet that only allows `tag:outside-agent` → `tag:grokbot-box:22`. Copy the private key onto the agent device only. Do not put it in this repo.

Revoke:

```fish
ssh box@grokbot-box "{ grep -v ' grokbot-gateway-claude-code\$' ~/.ssh/authorized_keys || true; } > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys"
```

## How an agent should work

- Chat, setup, and "please do X with approval" → `grokbot` CLI or MCP (`ask_bot` / `send_to_bot`).
- Look at files on the box → `box_list` / `box_read_file` (or `grokbot box ls` / `cat`).
- Change files, run processes, install packages **on the box** → `ssh box@grokbot-box`, or ask the bot.
- Do not expose the box's own gateway port (`1340`) on the public internet. SSH (or a Tailscale serve on that host) is the path.

## Remove access

- Tailscale SSH: remove the box from the tailnet in the admin console, or tighten the `ssh` rule.
- HTTP MCP: `grokbot token revoke <name>` (box tools need the `box:read` scope).
