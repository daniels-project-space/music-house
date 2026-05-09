#!/usr/bin/env bash
cd /home/ubuntu/music-house
BB_API_KEY=$(curl -s -X POST 'https://fantastic-roadrunner-485.convex.cloud/api/query' \
  -H 'Content-Type: application/json' \
  -d '{"path":"secrets:getOne","args":{"service":"browserbase","keyName":"BROWSERBASE_API_KEY"},"format":"json"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["value"]["value"])')
export BB_API_KEY
export BB_PROJECT_ID=f4d2c040-9578-4974-b385-9915e5ba03b7
node bootstrap-auth.mjs
