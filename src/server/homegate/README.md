# Homegate Server Flow

This folder owns Passport's server-side Homegate invitation flow. Its Google client
performs the upstream HTTP request; the flow validates the input and maps upstream
results to safe typed route outcomes.

Homegate, not Passport, verifies Google credentials and enforces invite quotas for
this flow. Server code does not log or retain a Google ID token, signup code, or raw
Homegate response.
