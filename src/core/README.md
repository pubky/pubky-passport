# Core

`src/core` holds pure Passport rules, models, and parsers available to browser and
server code. It imports neither runtime framework APIs nor concrete integrations.

- `auth/` parses and validates Pubky authorization requests.
- `homegate/` owns canonical Homegate URL policy.
- `identity/` owns public, runtime-neutral identity models.
- `passport-file/` owns the encrypted Passport file format and parser.

Runtime-specific flows and their dependency shapes live in the matching
`src/browser/<feature>` or `src/server/<feature>` folder. Keep a rule here only
when it has no intrinsic browser or server dependency.

Core modules must not import Next.js, React, browser or server code, shared libraries,
environment modules, Google or Pubky SDKs, browser globals, or `process.env`.
