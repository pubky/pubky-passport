# Pubky documentation snapshot

Run:

```bash
./scripts/fetch-pubky-docs.sh
```

This should create:

```txt
docs/vendor/pubky/llms-small.txt
docs/vendor/pubky/llms-full.txt
```

Agent usage:

1. Read `llms-small.txt` first.
2. Search `llms-full.txt` only for specific details.
3. Do not hallucinate Pubky SDK APIs.
