# Authorization Feature

Parses `pubkyauth://` requests, capabilities, relay policy, and callbacks. The
shared parameter grammar rejects duplicate or unsupported fields.

Parsing returns a safe review model plus an opaque approval request. The raw URL and
secret stay out of UI state; approval requires the parser-issued request. Relay
origins are injected from the same configuration used by CSP.
