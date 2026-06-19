# ADR-0001: Passport encrypted file format

Status: Accepted for bootstrap, pending SDK representation verification

## Context

Passport stores encrypted Pubky key material in Google Drive as `passport.json`.

The PRD proposes:

```json
{
  "v": 1,
  "iv": "...",
  "ct": "...",
  "url": "https://passport.pubky.app"
}
```

## Bootstrap Decision

Use a versioned encrypted `passport.json` stored in Google Drive `appDataFolder` as the primary MVP storage mechanism.

The initial envelope shape is:

- `v`: schema version.
- `iv`: encryption initialization vector or nonce.
- `ct`: ciphertext for encrypted Pubky key material.
- `url`: Passport public URL that created the file.

Only encrypted key material may be persisted. The exact plaintext payload inside `ct` must be determined by the Pubky SDK key-material spike before implementation.

## Questions

- What exact Pubky key material is encrypted?
- Is it a seed, full keypair, or SDK-specific representation?
- Is MVP single identity or multiple identities?
- Do we include `kid`?
- Do we include algorithm metadata?
- Do we include public Pubky?
- Do we include timestamps?
- What migration strategy is required?

## Constraints

- Must restore a real Pubky keypair.
- Must support AuthToken signing.
- Must be versioned.
- Must support future migration.
- Must not store plaintext private key material.

## Outcome

Proceed with the encrypted file envelope in architecture and tests. Do not implement encryption or Drive persistence until the Pubky SDK spike confirms the exact serializable key representation.
