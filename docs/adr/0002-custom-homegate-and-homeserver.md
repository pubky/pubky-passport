# 0002. Custom homegate, invite codes, and custom homeserver

Status: Proposed
Date: 2026-09-25

## Context

Users must be able to create an account on a homeserver other than the instance default, either by entering an invite code for the default homegate, or by pointing Passport at a different homegate URL, or by naming a homeserver directly when the instance allows it. Each of these is a place where a user can be steered toward attacker infrastructure, and each user-entered URL is a potential SSRF vector if the server ever fetches it.

## Decision

- Homeserver selection has exactly three sources, evaluated in this order and shown to the user on a confirmation screen before any network call: (1) instance default from ADR 0001; (2) the homeserver returned by the chosen homegate for the invite code; (3) a user-entered homeserver pubky, only when `PASSPORT_ALLOW_CUSTOM_HOMESERVER` is true.
- An invite code is only ever sent to the homegate the user selected and only unlocks the homeserver that homegate returns. The code is never placed in a URL and never logged.
- Custom homegate URLs pass `validateOperatorUrl()` in `src/libs/url/`: `https:` only, no userinfo, no IP literals or `localhost` in production builds, normalised to an origin. The origin is displayed verbatim before first use and remembered per browser in `localStorage` under a namespaced key. Instances with a fixed `PASSPORT_ALLOWED_HOMEGATES` list reject anything else at the boundary with a user-visible error that does not echo the rejected value into logs.
- The Passport server never fetches user-entered URLs. All homegate and homeserver traffic is browser-side, constrained by CSP connect-src derived from config. If a server-side fetch becomes necessary, it gets its own ADR and an allowlist.
- Browser-side calls to the chosen homegate go through `src/client/logic/homegate/` with its existing error union extended, not through ad-hoc fetch calls in UI.

## Boundaries touched

B5, B6, B8.

## Consequences

- CSP `connect-src` must be widened to `https:` when `PASSPORT_ALLOWED_HOMEGATES=*` or custom homeservers are allowed. That is a deliberate operator choice recorded in `PublicInstanceConfig` and surfaced in the UI as "this instance allows custom servers".
- E2E tests need a second mock homegate.

## Open questions

- Persist the custom homegate choice across devices via the recovery file, or keep it per browser?
