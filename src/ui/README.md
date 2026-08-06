# Passport UI Foundation

The production UI is organized by Passport feature. Shared visual primitives live in
`components`; feature components should remain in their owning feature until reuse is
demonstrated.

```txt
ui/
  components/       SHADCN-derived, Figma-verified primitives
  lib/              UI-only helpers
  identity/         identity list, selection, Google create/restore, management
  authorization/    manual entry, identity choice, permission review, result
```

## Sources

- Figma file `01ZvjSPZnKTNmaEWz0yJsq`, node `42046:184413` is the visual source of
  truth for the initial Button variants and tokens.
- `pubky/pubky-app` commit `2bfe3f5c379a10f75c9811db9d7e47f7bb56f508`
  supplies the compatible SHADCN/Tailwind implementation pattern.

Copy only the variants required by Passport and verify them against Figma. Do not
copy pubky-app's application state, routes, social components, or full component
hierarchy.

## Initial screen states

- Home: no local identity, identity list, active identity, Google action pending,
  identity setup/restore progress, safe failure.
- Identity management: select, add with Google, local-only logout, verified Google
  Drive deletion.
- Manual authorization: empty, pasted, clipboard denied, invalid, navigating.
- Authorization: invalid request, identity required, identity selection, permission
  review, approving, redirecting, approved, cancelled, failed.

UI state contains public identity data, safe hosts, capabilities, progress, and typed
safe errors only. It never contains tokens, secret key material, wrapping keys,
ciphertext, raw authorization URLs, request secrets, or full callback URLs.
