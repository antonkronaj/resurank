#!/usr/bin/env bash
# install.sh — set up resurank-mcp in Claude Desktop in one command.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/antonkronaj/resurank/main/packages/mcp-server/install.sh)
#   bash <(curl -fsSL ...) /absolute/path/to/resume.pdf   # non-interactive
#
# Supports: macOS, Linux
# Requires: Node.js v22+, Claude Desktop

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
  BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

info()  { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
die()   { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
bold()  { printf "${BOLD}%s${NC}\n" "$*"; }
blank() { echo ""; }

# ── 1. Platform ───────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin)
    PLATFORM="macos"
    CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    ;;
  Linux)
    PLATFORM="linux"
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
    CONFIG_PATH="$XDG_CONFIG_HOME/Claude/claude_desktop_config.json"
    ;;
  *)
    die "This script supports macOS and Linux only.
Windows users: edit claude_desktop_config.json manually — see the README."
    ;;
esac

# ── 2. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  die "Node.js not found. Install v22+ from https://nodejs.org then re-run."
fi

NODE_VERSION=$(node -e 'process.stdout.write(process.versions.node)')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node.js v$NODE_VERSION found but v22+ is required. Update from https://nodejs.org"
fi
info "Node.js v$NODE_VERSION"

# ── 3. Claude Desktop ─────────────────────────────────────────────────────────
if [ "$PLATFORM" = "macos" ]; then
  if [ ! -d "/Applications/Claude.app" ] && [ ! -d "$HOME/Applications/Claude.app" ]; then
    die "Claude Desktop not found in /Applications or ~/Applications.
Download it from https://claude.ai/download then re-run."
  fi
  info "Claude Desktop found"
else
  # Linux: can't reliably detect — proceed and let Claude Desktop pick up the config
  warn "Linux detected — skipping Claude Desktop install check."
fi

# ── 4. Resume path ────────────────────────────────────────────────────────────
RESUME_PATH="${1:-}"

if [ -z "$RESUME_PATH" ]; then
  blank
  bold "Where is your resume file?"
  printf "  Supported formats: .pdf  .docx  .txt  .md\n"
  printf "  Enter the absolute path: "
  # Read from /dev/tty so this works whether stdin is a pipe or a terminal.
  read -r RESUME_PATH </dev/tty
  blank
fi

# Expand a leading ~ to $HOME
RESUME_PATH="${RESUME_PATH/#\~/$HOME}"

[ -n "$RESUME_PATH" ] || die "No resume path provided."
[ -f "$RESUME_PATH" ] || die "File not found: $RESUME_PATH
  Check the path and try again."

EXT=$(echo "${RESUME_PATH##*.}" | tr '[:upper:]' '[:lower:]')
case "$EXT" in
  pdf|docx|txt|md) ;;
  *) die "Unsupported file type: .$EXT  (supported: .pdf .docx .txt .md)" ;;
esac

info "Resume: $RESUME_PATH"

# ── 5. Write config ───────────────────────────────────────────────────────────
bold "Writing Claude Desktop config…"

# Hand off to Node for a safe JSON merge. Avoids fragile sed/awk JSON hacks and
# preserves any other MCP servers already registered in the file.
node - "$CONFIG_PATH" "$RESUME_PATH" <<'NODE'
const fs   = require('fs');
const path = require('path');

const [,, configPath, resumePath] = process.argv;

const dir = path.dirname(configPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let config = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch {
      process.stderr.write(
        `\n✗ ${configPath} exists but is not valid JSON.\n` +
        `  Fix it manually then re-run this script.\n\n`
      );
      process.exit(1);
    }
  }
}

config.mcpServers = config.mcpServers || {};
config.mcpServers.resurank = {
  command: 'npx',
  args:    ['-y', 'resurank-mcp'],
  env:     { RESUME_PATH: resumePath },
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
NODE

info "Config written: $CONFIG_PATH"

# ── 6. Done ───────────────────────────────────────────────────────────────────
blank
bold "All done! One last step:"
blank
printf "  Restart Claude Desktop"
[ "$PLATFORM" = "macos" ] && printf " (Cmd-Q, then relaunch)" || printf " (quit and relaunch)"
printf " to activate the connection.\n"
blank
printf "  Then open a new conversation and type:\n"
printf "    \"Use the resurank tool to score my resume against this job posting.\"\n"
blank
printf "  The first score will download the embedding model (~25 MB) — allow 10–30 s.\n"
blank
