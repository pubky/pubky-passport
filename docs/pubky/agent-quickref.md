# Pubky Passport Technical Quick Reference

## Pubky model

Pubky uses:

- Public-key identity.
- Homeserver storage.
- PKARR / Mainline DHT-style discovery.
- HTTP/REST interfaces.
- Pubky Auth for app authorization.

## Passport role

Passport is a web authenticator/onboarding app.

For MVP, Passport supports Google-backed onboarding only.

Passport should:

1. Receive Pubky Auth request.
2. Restore or create Pubky identity.
3. Show requested capabilities.
4. Ask user to authorize.
5. Sign Pubky AuthToken with the real Pubky key.
6. Return encrypted token via HTTP Relay.
7. Redirect back to third-party app.

## Pubky Auth request facts

The PRD example uses:

```txt
pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=...&success-x=https://pubky.app/passport-success
```

Then URL-encodes it into:

```txt
https://passport.pubky.app/authorize?d=<encoded-pubkyauth-url>
```

Bootstrap transport baseline:

- Support `/authorize?d=<encoded-pubkyauth-url>` first because it matches the PRD and third-party app examples.
- Treat the decoded `pubkyauth://` request and its `secret` as sensitive.
- Add no-store, no-referrer, no raw URL persistence, and strict redaction mitigations when the route is implemented.
- Future fragment or POST handoff support belongs in a separate tracked PR if integration requirements change.

## Capabilities

Capabilities should follow least privilege.

Do not sign until the user sees requested capabilities.

Example display:

```txt
/pub/pubky.app/  READ WRITE
/pub/eventky/    READ
```

## Key material warning

Do not assume the hackathon key format is production-correct.

Before implementing Google Drive storage, confirm exact `@synonymdev/pubky` APIs for:

- Keypair generation.
- Keypair serialization/export.
- Keypair restoration/import.
- Public key derivation.
- AuthToken signing.
- Homeserver signup.
- PKDNS / PKARR publication.

## Vendor docs

Compact docs:

```txt
docs/vendor/pubky/llms-small.txt
```

Full docs:

```txt
docs/vendor/pubky/llms-full.txt
```

Rules:

- Read compact docs first.
- Search full docs only for specific details.
- Do not hallucinate SDK APIs.
- When SDK facts are unclear, do a small spike and update `docs/product/feature-context.md` before coding concrete adapters.
