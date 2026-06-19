# ADR-0003: Google Drive scopes and storage

Status: Accepted for MVP baseline

## Context

Passport stores encrypted key material in Google Drive.

Primary storage:

```txt
Google Drive appDataFolder/passport.json
```

The PRD also proposes a visible encrypted backup:

```txt
Google Drive/Pubky Passport/encrypted_key_{app_domain}.json
```

## Decision

Use Google Drive `appDataFolder/passport.json` as primary MVP storage. Request the narrow app-data scope needed for hidden app-specific storage first.

Visible encrypted backup remains an MVP entry point and follow-up implementation path, not part of the initial Drive persistence PR unless a tracked issue scopes the additional Drive permission and UX.

## Questions

- Request appDataFolder scope only?
- Request visible backup scope in MVP?
- Use incremental consent?
- Write visible backup immediately?
- Support restore from visible backup in MVP?
- What happens if user denies Drive access?

## Constraints

- Minimize OAuth scopes.
- Store encrypted file only.
- Do not send Drive access token to Passport server.
- Preserve recovery path if Google removes app access.

## Outcome

Implement hidden appDataFolder storage first. Any visible backup scope must be introduced through a small, reviewed PR with user-facing consent copy and recovery validation.
