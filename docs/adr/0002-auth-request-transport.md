# ADR-0002: Pubky auth request transport

Status: Accepted for MVP baseline

## Context

The PRD passes an encoded `pubkyauth://` URL through:

```txt
https://passport.pubky.app/authorize?d=...
```

The auth request includes a `secret`.

## Risk

Query strings can leak through:

- Server logs.
- Browser history.
- Analytics.
- Referrers.
- Screenshots.
- Error reports.

## Decision

Support the PRD transport first:

```txt
/authorize?d=<encoded-pubkyauth-url>
```

The parser and route must treat the raw `d` parameter, decoded `pubkyauth://` URL, request secret, and callback URLs with query parameters as sensitive.

## Considered Options

### Option A — Query parameter

```txt
/authorize?d=<encoded-pubkyauth-url>
```

Pros:

- Simple.
- Matches PRD.

Cons:

- Higher leakage risk.

### Option B — URL fragment

```txt
/authorize#d=<encoded-pubkyauth-url>
```

Pros:

- Fragment normally does not reach server logs.
- Reduces accidental leakage.

Cons:

- Requires client-side parsing.
- May require PubkyApp changes.

### Option C — POST/session handoff

Pros:

- Best control.

Cons:

- More complex.
- More integration work.

## Required Mitigations

- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`
- Strict log redaction
- No persistence of raw auth URL
- Short TTL where applicable

## Outcome

Implement query-parameter support first with the mitigations above. Fragment or POST/session handoff can be added later only as a focused transport-change PR.
