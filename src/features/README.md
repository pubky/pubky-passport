# Features

`src/features` holds pure Passport rules, models, and parsers shared by browser and
server code. It imports neither runtime framework APIs nor concrete integrations.

Organize by product concept, not by technical layer:

- `auth/` parses and validates Pubky authorization requests.
- `identity/` owns provider-neutral identity models.
- `passport-file/` owns the encrypted Passport file format and parser.

Runtime-specific flows and their dependency shapes live in the matching
`src/browser/<feature>` or `src/server/<feature>` folder. Keep a rule here only
when it has no intrinsic browser or server dependency.

Features must not import Next.js, React, browser or server code, environment modules,
Google or Pubky SDKs, browser globals, or `process.env`.
