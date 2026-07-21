# Core

`src/core` holds pure Passport rules, models, and feature flows. It is shared by
browser and server code, so it imports neither runtime framework APIs nor concrete adapters.

Organize by product concept, not by technical layer:

- `auth/` parses and validates Pubky authorization requests.
- `identity/` owns identity models and wrapping-key flow rules.
- `homegate/` owns Homegate invitation flow rules.
- `passport-file/` owns the encrypted Passport file format and parser.

Each feature declares the external behavior it needs beside that feature, usually
in a `dependencies/` folder. These are small TypeScript contracts, not a shared
`ports` registry. Concrete adapters and test fakes import the owning feature's
types; composition chooses the concrete implementation.

Core must not import Next.js, React, adapters, composition, environment modules,
Google or Pubky SDKs, browser globals, or `process.env`.
