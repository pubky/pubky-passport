# Homegate Server Flow

Owns the server-side Homegate invitation flow. The Google client forwards a Google ID
token to Homegate, which verifies it and enforces invite quotas; Passport maps the
result to safe typed outcomes and never logs the token or raw upstream response.
