#!/usr/bin/env bash
# Prepare this machine to SSH to grokbot-box over Tailscale.
# Run on the outside agent's device (or the Mac that can already reach the box).
set -euo pipefail

BOX_HOST="${GROKBOT_BOX_HOST:-grokbot-box}"
BOX_USER="${GROKBOT_BOX_USER:-box}"
HOME_DIR="${GROKBOT_GATEWAY_HOME:-$HOME/.config/grokbot-gateway}"
SSH_DIR="$HOME_DIR/ssh"
KEY="$SSH_DIR/local_ed25519"

umask 077
mkdir -p "$SSH_DIR"
chmod 700 "$HOME_DIR" "$SSH_DIR"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found. Install Tailscale and join the same tailnet as grokbot-box." >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "tailscale is installed but not logged in. Run: tailscale up" >&2
  exit 1
fi

if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "grokbot-gateway-local"
fi

echo "Public key:"
cat "$KEY.pub"
echo
echo "Install it on the box (you will be prompted for the existing box login once):"
echo "  ssh ${BOX_USER}@${BOX_HOST} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys' < ${KEY}.pub"
echo
echo "Then connect with:"
echo "  ssh -i ${KEY} -o IdentitiesOnly=yes ${BOX_USER}@${BOX_HOST}"
echo
echo "Add this to ~/.ssh/config:"
cat <<EOF
Host ${BOX_HOST}
  HostName ${BOX_HOST}
  User ${BOX_USER}
  IdentityFile ${KEY}
  IdentitiesOnly yes
EOF
