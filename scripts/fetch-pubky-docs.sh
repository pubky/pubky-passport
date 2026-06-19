#!/usr/bin/env bash
set -euo pipefail

mkdir -p docs/vendor/pubky

curl -fsSL "https://pubky.org/llms-small.txt" \
  -o docs/vendor/pubky/llms-small.txt

curl -fsSL "https://pubky.org/llms-full.txt" \
  -o docs/vendor/pubky/llms-full.txt

cat > docs/vendor/pubky/SOURCE.md <<SRC
# Pubky documentation snapshot

Fetched at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

Sources:

- https://pubky.org/llms-small.txt
- https://pubky.org/llms-full.txt

Usage:

- Read llms-small.txt first.
- Search llms-full.txt only for specific Pubky SDK/Auth/Homegate/Relay details.
SRC
