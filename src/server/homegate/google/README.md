# Homegate Server Adapter

This adapter calls Homegate's Google verification endpoint to obtain a homeserver
signup invitation. Homegate is the authority for this token verification and invite
quota; Passport validates local request shape and maps Homegate responses to safe
typed results.

The Google ID token is forwarded only to Homegate. Do not add local token
verification, persistent quota tracking, raw upstream-response logging, or fallback
homeserver selection in this folder.
