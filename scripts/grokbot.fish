# Fish snippet for macOS / Linux.
#   source scripts/grokbot.fish
# Copy into ~/.config/fish/config.fish if you want it permanent.
# bash/zsh equivalent: source scripts/env.sh

if test -d $HOME/.local/share/pnpm
    fish_add_path $HOME/.local/share/pnpm
end

if test -d $HOME/Library/pnpm
    fish_add_path $HOME/Library/pnpm
end

set -q GROKBOT_GATEWAY_HOME; or set -gx GROKBOT_GATEWAY_HOME $HOME/.config/grokbot-gateway
set -q GROKBOT_BOX_HOST; or set -gx GROKBOT_BOX_HOST grokbot-box

# Optional: if GrokBot Notch is running and you want the gateway to use it
# instead of the standalone ConnectRPC transport:
# set -gx GROKBOT_TRANSPORT notch
# set -gx GROKBOT_NOTCH_URL http://127.0.0.1:4789
