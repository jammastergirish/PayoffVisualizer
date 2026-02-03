#!/bin/bash

clear && printf '\e[3J'

# Kill background processes on exit
trap 'kill $(jobs -p)' EXIT

echo "🚀 Starting TradeShape..."

# 1. Start Backend (Python)
echo "🐍 Starting Backend..."

# Run Uvicorn via uv
# Ensure port 8000 is free
lsof -t -i:8000 | xargs kill -9 2>/dev/null || true

# uv automatically handles venv creation and dependency installation
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Load local env vars (ngrok creds, etc.)
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi

# 2. Start Frontend (Next.js)
echo "⚛️  Starting Frontend..."
cd frontend
npm install > /dev/null 2>&1 # Ensure deps are installed

# 3. Start ngrok tunnel (Frontend)
if command -v ngrok >/dev/null 2>&1; then
  NGROK_DOMAIN=${NGROK_DOMAIN:-${NGROK_URL:-ag-tradeshape.ngrok.io}}
  NGROK_PORT=${NGROK_PORT:-3000}
  if [ -n "$NGROK_OAUTH_PROVIDER" ]; then
    if [ -z "$NGROK_OAUTH_ALLOW_EMAILS" ]; then
      echo "ngrok oauth allow list not set; skipping tunnel."
    else
      echo "Starting ngrok tunnel..."
      ngrok_args=(http --domain="$NGROK_DOMAIN" "$NGROK_PORT" --oauth="$NGROK_OAUTH_PROVIDER")
      IFS=',' read -r -a ngrok_emails <<< "$NGROK_OAUTH_ALLOW_EMAILS"
      for email in "${ngrok_emails[@]}"; do
        email=$(echo "$email" | xargs)
        if [ -n "$email" ]; then
          ngrok_args+=(--oauth-allow-email "$email")
        fi
      done
      ngrok "${ngrok_args[@]}" > /dev/null 2>&1 &
    fi
  else
    echo "ngrok oauth not set; skipping tunnel."
  fi
else
  echo "ngrok not found; skipping tunnel."
fi

npm run dev

# Wait for any process to exit
wait
