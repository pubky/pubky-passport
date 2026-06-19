# Pubky Passport

Pubky Passport is a standalone web app for `https://passport.pubky.app`.

The first MVP supports Login with Google only. It receives a Pubky auth deep link, restores or creates a Pubky identity, stores encrypted key material in Google Drive, retrieves a Homegate invite from a valid Google ID token, signs the Pubky auth grant after capability review, and redirects back to the third-party app.

## Development

```bash
corepack enable
pnpm install
pnpm check
```

This environment may not have `corepack` installed. In that case install pnpm matching `packageManager` in `package.json`.

## Context

- Product scope: `docs/product/passport-mvp-brief.md`
- Feature context: `docs/product/feature-context.md`
- Agent instructions: `AGENTS.md` and `opencode.json`
- Architecture rules: `docs/architecture/clean-architecture.md`
- Security model: `docs/security/passport-security-model.md`
- Roadmap: `docs/planning/mvp-roadmap.md`
- Pubky references: `docs/pubky/agent-quickref.md` and `docs/vendor/pubky/`

## Implementation Order

Do not ask an AI agent to build all of Passport at once. Build one thin vertical slice at a time, starting with the Pubky auth request parser described in `docs/planning/next-pr-auth-parser-plan.md`.
