# Identity Core

This feature owns Pubky identity models and flows. `requestWrappingKey.ts` defines
the server-side sequence for verifying a provider token, applying a rate limit,
and deriving wrapping material. Future setup, restore, and authorization flows
also belong here.

External behavior required by those flows is defined under `dependencies/`. The
contracts are local because they describe identity work, not generic application
services. Adapters and test fakes depend on these types; this folder never imports
their concrete implementations.
