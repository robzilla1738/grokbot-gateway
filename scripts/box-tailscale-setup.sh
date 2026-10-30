#!/bin/sh
# Run ON the Grok Bot VM (the box), as the box user. Installs Tailscale in
# userspace with Tailscale SSH so outside agents can reach the box. Grok Bot
# VMs are containers with no root, systemd, cron, or sshd, so everything lives
# under $HOME and a ~/.bashrc hook restarts tailscaled.
#
#   curl -fsSLo /tmp/box-tailscale-setup.sh https://raw.githubusercontent.com/robzilla1738/grokbot-gateway/main/scripts/box-tailscale-setup.sh
#   sh /tmp/box-tailscale-setup.sh
#
# Safe to re-run. Env: GROKBOT_BOX_HOST (tailnet hostname, default grokbot-box).
set -eu

HOSTNAME_WANTED="${GROKBOT_BOX_HOST:-grokbot-box}"
TS_DIR="$HOME/.local/tailscale"
STATE="$HOME/.local/share/tailscale"
SOCK="$STATE/tailscaled.sock"
ENSURE="$HOME/.local/bin/grokbot-tailscale-ensure"
TS="$TS_DIR/tailscale"

umask 077
mkdir -p "$TS_DIR" "$STATE" "$HOME/.local/bin"

if [ ! -x "$TS_DIR/tailscaled" ]; then
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
  tarball=$(curl -fsSL 'https://pkgs.tailscale.com/stable/?mode=json' | tr ',' '\n' | sed -n "s/.*\"$arch\": *\"\(tailscale_[^\"]*\.tgz\)\".*/\1/p" | head -n 1)
  [ -n "$tarball" ] || { echo "could not find a Tailscale tarball for $arch" >&2; exit 1; }
  echo "Downloading $tarball"
  curl -fsSL "https://pkgs.tailscale.com/stable/$tarball" | tar xz -C "$TS_DIR" --strip-components=1
fi
echo "Tailscale $("$TS" version | head -n 1) in $TS_DIR"

cat > "$ENSURE" <<'ENSURE_EOF'
#!/bin/sh
# Start userspace tailscaled (with Tailscale SSH) if it is not running.
# --restart forces a restart, for when the box shows offline on the tailnet.
TS="$HOME/.local/tailscale"
STATE="$HOME/.local/share/tailscale"
SOCK="$STATE/tailscaled.sock"
[ -x "$TS/tailscaled" ] || exit 0
pid=$(pgrep -u "$(id -u)" -f "^$TS/tailscaled --tun=userspace-networking" || true)
if [ "${1:-}" = "--restart" ] && [ -n "$pid" ]; then
  kill $pid 2>/dev/null || true
  sleep 2
  pid=""
fi
if [ -z "$pid" ]; then
  nohup "$TS/tailscaled" --tun=userspace-networking --statedir="$STATE" --socket="$SOCK" >>"$STATE/tailscaled.log" 2>&1 &
fi
ENSURE_EOF
chmod 700 "$ENSURE"

if ! grep -q grokbot-tailscale-ensure "$HOME/.bashrc" 2>/dev/null; then
  tmp=$(mktemp)
  {
    echo "# grokbot-gateway: keep Tailscale (SSH for outside agents) running"
    # shellcheck disable=SC2016 # expand $HOME when .bashrc runs, not now
    echo '[ -x "$HOME/.local/bin/grokbot-tailscale-ensure" ] && "$HOME/.local/bin/grokbot-tailscale-ensure" >/dev/null 2>&1'
    cat "$HOME/.bashrc" 2>/dev/null || true
  } > "$tmp"
  cat "$tmp" > "$HOME/.bashrc"
  rm -f "$tmp"
  echo "Added the restart hook to ~/.bashrc"
fi

"$ENSURE"
i=0
until "$TS" --socket="$SOCK" status >/dev/null 2>&1 || "$TS" --socket="$SOCK" status 2>&1 | grep -qi "logged out\|NeedsLogin"; do
  i=$((i + 1))
  [ "$i" -lt 20 ] || { echo "tailscaled did not start; see $STATE/tailscaled.log" >&2; exit 1; }
  sleep 1
done

if "$TS" --socket="$SOCK" status >/dev/null 2>&1; then
  "$TS" --socket="$SOCK" set --ssh --accept-risk=lose-ssh --hostname="$HOSTNAME_WANTED" >/dev/null 2>&1 || true
  echo "Already on the tailnet:"
  "$TS" --socket="$SOCK" status | head -n 1
  echo "From a tailnet device: ssh box@$HOSTNAME_WANTED"
  exit 0
fi

UP_LOG="$STATE/up.log"
: > "$UP_LOG"
nohup "$TS" --socket="$SOCK" up --ssh --accept-risk=lose-ssh --hostname="$HOSTNAME_WANTED" >>"$UP_LOG" 2>&1 &
i=0
until grep -q "https://login.tailscale.com/" "$UP_LOG"; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || { echo "no login URL after 30s. $UP_LOG says:" >&2; cat "$UP_LOG" >&2; exit 1; }
  sleep 1
done
url=$(grep -o "https://login.tailscale.com/[^ ]*" "$UP_LOG" | head -n 1)
echo
echo "Open this link and approve the device (named $HOSTNAME_WANTED):"
echo "  $url"
echo
echo "If an old offline $HOSTNAME_WANTED is still on the tailnet, remove it first or this one becomes $HOSTNAME_WANTED-1."
echo "Then, from a tailnet device: ssh box@$HOSTNAME_WANTED"
