# Pubky Auth Request Validation

Owns the pure request grammar shared by browser authorization and server Content
Security Policy generation. It validates the encoded `d` value, `pubkyauth://`
shape, secret, capabilities, relay, callbacks, supported parameters, and documented
size limits.

Successful parsing returns normalized request data. Browser approval provenance,
review projection, callback metadata storage, query scrubbing, signing, navigation,
and UI state do not belong in core.

The browser consumes the full parsed request to create a browser-local approval
capability. Manual entry uses validation only. Server CSP uses only the normalized
relay origin and never imports browser authorization code.

All supplied success, error, and cancel callbacks must be HTTPS URLs sharing one
origin. Relay URLs must be exact CSP-safe HTTPS URLs without credentials, fragments,
wildcard hosts, or hostname delimiters.
