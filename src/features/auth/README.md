# Authorization Feature

Parses `pubkyauth://` requests, capabilities, relay policy, and callbacks. The
shared parameter grammar rejects duplicate or unsupported fields.

Parsing returns a safe review model plus an opaque approval request. The raw URL and
secret stay out of UI state; approval requires the parser-issued request. Relay
origins are injected from the same configuration used by CSP.

Canonical validated callbacks are held in module-private weak metadata keyed by
the exact parser-issued approval object. The callback accessor returns no metadata
for copied or forged objects, and callback URLs are not part of the review model.

All supplied success, error, and cancel callbacks must share one origin. Parsing
also applies explicit bounds before URL and capability processing: encoded `d`
24,576 characters, decoded auth URL 8,192, relay and each callback 2,048, secret
1,024, at most 64 capabilities, each capability 1,024, and each path 1,000.
