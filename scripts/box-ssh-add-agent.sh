#!/usr/bin/env bash
# Mint a dedicated ed25519 key for one outside agent and install the public
# key on grokbot-box. The private key stays on the agent's device.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <agent-name> [box-user]" >&2
  echo "example: $0 claude-code box" >&2
  exit 1
fi

AGENT="$1"
BOX_USER="${2:-${GROKBOT_BOX_USER:-box}}"
BOX_HOST="${GROKBOT_BOX_HOST:-grokbot-box}"
HOME_DIR="${GROKBOT_GATEWAY_HOME:-$HOME/.config/grokbot-gateway}"
SSH_DIR="$HOME_DIR/ssh"
KEY="$SSH_DIR/${AGENT}_ed25519"
COMMENT="grokbot-gateway-${AGENT}"

if [[ ! "$AGENT" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "agent name must be [a-zA-Z0-9._-]+" >&2
  exit 1
fi

umask 077
mkdir -p "$SSH_DIR"
chmod 700 "$HOME_DIR" "$SSH_DIR"

if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "$COMMENT"
fi

PUB="$(cat "$KEY.pub")"
echo "Installing public key on ${BOX_USER}@${BOX_HOST}..."
# Restrict the key to that comment so it is easy to revoke later.
ssh "${BOX_USER}@${BOX_HOST}" "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -F '$COMMENT' ~/.ssh/authorized_keys >/dev/null 2>&1 || echo '$PUB' >> ~/.ssh/authorized_keys"

cat <<EOF

Private key (keep on the agent device only):
  $KEY

SSH:
  ssh -i $KEY -o IdentitiesOnly=yes ${BOX_USER}@${BOX_HOST}

Revoke on the box:
  ssh ${BOX_USER}@${BOX_HOST} "grep -v '$COMMENT' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys"

Tailscale ACL snippet (merge into the tailnet policy). Replace the src tag
with the agent's device tag:

{
  "tagOwners": {
    "tag:grokbot-box": ["autogroup:admin"],
    "tag:outside-agent": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:outside-agent"],
      "dst": ["tag:grokbot-box:22"]
    }
  ],
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:outside-agent"],
      "dst": ["tag:grokbot-box"],
      "users": ["${BOX_USER}"]
    }
  ]
}

Do not open port 22 on the public internet. Do not grant the agent tag access
to other hosts.
EOF
