# Authorization Feature

This feature parses and validates `pubkyauth://` requests. It owns capability
parsing plus relay and callback URL safety rules, and returns safe typed failures
for UI or route code to map.

Authorization URLs and their request secrets are sensitive. Code in this folder
must not persist, log, or display raw request URLs. It returns only the information
needed to show a safe requesting-app identity and capability review. The supported
request parameters are defined once in `pubkyAuthRequestParameters.ts`; duplicates
and unsupported parameters are rejected before review data is created.

The parser receives approved relay origins as an explicit option. Route wiring must
derive this from the same configured relay origin used by the application's CSP;
the default empty allowlist rejects all relay URLs.

The parser returns separate values for UI review and approval. UI receives the safe
review model only; browser approval code receives the opaque validated request URL
that was parsed under the same grammar.
