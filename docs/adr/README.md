# Architecture decision records

One file per decision, numbered, never edited after acceptance except to mark it superseded. Status is one of `Proposed`, `Accepted`, `Superseded by NNNN`.

Agents: read the ADR for the area you are working in before writing code. If the work needs a decision that no ADR covers, write a `Proposed` ADR in the same PR and stop for a human decision before implementing the security-relevant part.

Template:

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context

## Decision

## Boundaries touched

## Consequences

## Open questions
```

| ADR                                            | Area                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| [0001](0001-instance-configuration.md)         | Instance configuration and feature flags         |
| [0002](0002-custom-homegate-and-homeserver.md) | Custom homegate, invite codes, custom homeserver |
| [0003](0003-passport-client-package.md)        | `@pubky/passport-client` npm package             |
| [0004](0004-profile-management.md)             | pubky-app-specs profile management               |
