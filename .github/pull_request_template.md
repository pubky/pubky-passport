## Intent

<!-- One paragraph: what changes and why. Link the issue. -->

## Boundaries touched

<!-- Tick every row from docs/security/threat-model.md this PR affects. "None" is a valid answer and must be true. -->

- [ ] None
- [ ] B1 app ↔ popup postMessage
- [ ] B2 browser ↔ server routes / CSP / environment
- [ ] B3 server ↔ Google
- [ ] B4 auth URL / relay / capabilities
- [ ] B5 homeserver signup / session
- [ ] B6 homegate / invite
- [ ] B7 instance configuration / feature flags
- [ ] B8 user-entered URLs
- [ ] B9 passport-client package
- [ ] B10 profile.json
- [ ] B11 dependencies / CI

If any box other than "None" is ticked: threat model and ADR updated in this PR, and the security review ran.

## How it was tested

<!-- Commands run and their result. Mention e2e when a flow changed. -->

## Authored by

<!-- human / claude / codex / cursor. The reviewer must be a different vendor than the author. -->
