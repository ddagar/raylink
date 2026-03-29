#!/bin/bash
# RayLink one-line setup script
# Usage: ./setup.sh
set -e

echo "=== RayLink Setup ==="

# Install dependencies
echo "Installing extension dependencies..."
npm install --silent

echo "Installing daemon dependencies..."
cd daemon && npm install --silent

echo "Building daemon..."
npm run build

echo "Starting daemon in background..."
node dist/index.js &
DAEMON_PID=$!
cd ..

echo ""
echo "=== Daemon running (PID: $DAEMON_PID) ==="
echo ""
echo "Opening Raycast extension in dev mode..."
echo "Once Raycast opens, the extension is registered and will persist."
echo ""

npm run dev
