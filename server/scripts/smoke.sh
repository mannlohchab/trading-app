#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"

echo "Health"
curl -sf "$BASE/health" | head -c 200; echo

echo "Login"
TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"emailOrUsername":"demo","password":"password123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

echo "Quote"
curl -sf "$BASE/api/market/quote/TCS" | head -c 160; echo

echo "Paper buy"
curl -sf -X POST "$BASE/api/trading/orders" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"symbol":"TCS","side":"BUY","orderType":"MARKET","quantity":1}' | head -c 200; echo

echo "Feed"
curl -sf "$BASE/api/community/feed" | head -c 160; echo

echo "AI suggestions"
curl -sf "$BASE/api/ai/suggestions" -H "Authorization: Bearer $TOKEN" | head -c 160; echo

echo "OK"
