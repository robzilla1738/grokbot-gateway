# bash / zsh env for grokbot-gateway.
#   source scripts/env.sh
# Does not print or export secrets.

: "${GROKBOT_GATEWAY_HOME:=$HOME/.config/grokbot-gateway}"
: "${GROKBOT_BOX_HOST:=grokbot-box}"
export GROKBOT_GATEWAY_HOME GROKBOT_BOX_HOST

# pnpm global bin (where `pnpm link --global` puts grokbot)
if command -v pnpm >/dev/null 2>&1; then
  _gb_pnpm_bin="$(pnpm bin -g 2>/dev/null || true)"
  if [ -n "$_gb_pnpm_bin" ]; then
    case ":$PATH:" in
      *":$_gb_pnpm_bin:"*) ;;
      *) PATH="$_gb_pnpm_bin:$PATH" ;;
    esac
  fi
  unset _gb_pnpm_bin
fi

for _gb_dir in "$HOME/.local/share/pnpm" "$HOME/Library/pnpm"; do
  if [ -d "$_gb_dir" ]; then
    case ":$PATH:" in
      *":$_gb_dir:"*) ;;
      *) PATH="$_gb_dir:$PATH" ;;
    esac
  fi
done
unset _gb_dir
export PATH
