#!/usr/bin/env bash
# One-command install from a clone. No curl | sh.
# This file is bash; fish and zsh can execute it the same way:
#   ./scripts/install-cli.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5+ is required. Install from https://nodejs.org or: brew install node@22" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
NODE_MINOR="$(node -p "process.versions.node.split('.')[1]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -lt 5 ]]; }; then
  echo "Node.js 22.5+ is required (node:sqlite). Current: $(node -v 2>/dev/null || echo missing)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "Enabling pnpm via corepack (no curl | sh)..."
    corepack enable
    corepack prepare pnpm@10 --activate
  elif command -v npm >/dev/null 2>&1; then
    echo "Installing pnpm with npm (no curl | sh)..."
    npm install -g pnpm
  else
    echo "Need pnpm. With Node 22: corepack enable && corepack prepare pnpm@10 --activate" >&2
    echo "Or: npm install -g pnpm" >&2
    exit 1
  fi
fi

pnpm install
pnpm build
pnpm link --global

BIN="$(command -v grokbot 2>/dev/null || true)"
echo
if [[ -n "$BIN" ]]; then
  echo "Installed grokbot -> $BIN"
else
  echo "grokbot is linked. If the shell cannot find it, add the pnpm global bin to PATH:"
  echo "  pnpm bin -g"
fi
echo
echo "Next:"
echo "  grokbot init"
echo "  grokbot doctor"
echo
echo "bash/zsh:  source scripts/env.sh"
echo "fish:      source scripts/grokbot.fish"
echo "Homebrew:  brew tap robzilla1738/grokbot-gateway https://github.com/robzilla1738/grokbot-gateway"
echo "           brew install --HEAD robzilla1738/grokbot-gateway/grokbot"
