#!/bin/bash
# MTGStream — Mac startup
# Double-click this file in Finder to launch.

cd "$(dirname "$0")"

# ── Check for Node.js ──────────────────────────────────────────
if ! command -v node &> /dev/null; then
  osascript -e 'display dialog "Node.js is required to run MTGStream.\n\nPlease install it from nodejs.org (LTS version), then double-click start.command again." buttons {"Open nodejs.org", "Cancel"} default button "Open nodejs.org"' 2>/dev/null
  open "https://nodejs.org/en/download"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "Node.js 18+ required (found v$(node --version)). Please update at nodejs.org."
  open "https://nodejs.org/en/download"
  exit 1
fi

# ── Install dependencies (first run only) ─────────────────────
if [ ! -d "node_modules" ]; then
  echo "First-time setup: installing dependencies…"
  echo "(This only happens once per machine)"
  npm install --omit=dev
  echo ""
fi

# ── Launch ────────────────────────────────────────────────────
echo "Starting MTGStream on http://localhost:3001"
echo "Press Ctrl+C to stop."
echo ""

# Open browser after a short delay so the server is ready
(sleep 2 && open "http://localhost:3001") &

node server/index.js
