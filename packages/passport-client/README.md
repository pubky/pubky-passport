# @pubky/passport-client

A popup outcome is a UI signal. Only a Pubky SDK `Session` authenticates the user.

This workspace package is private and under construction. It stays unpublished until the npm
scope is confirmed and `passport.pubky.app` serves `/authorize` with opener protocol v2 and the
verified-requester display. The default instance is `https://passport.pubky.app`.

The package has zero runtime dependencies. The app supplies the Pubky SDK as a peer; React is an
optional peer for the React entry point. The scaffold exports `DEFAULT_PASSPORT_INSTANCE`,
`PassportConfigError` and the option/state types; client, element, QR and React behavior arrives
in subsequent changes.

Configuration defaults to identity-only capabilities and a required Pubky profile. Browser-derived
names and return paths are resolved on the first browser operation. Advanced timeouts must be
integer milliseconds from 1 through 2147483647. Shortening `attemptMs` also shortens the default
redirect-state lifetime; an explicitly supplied lifetime cannot exceed the attempt timeout.
Undefined timeout fields retain their defaults. App names follow Passport's source-character rule:
joiners used in multilingual spelling and emoji are accepted; controls, bidi controls and zero-width
spaces are rejected. Configuration errors name the invalid option without echoing its value.

## Security

The build checks the private manifest, peer versions and import locations, rejects the specified
unsafe API tokens in minified output and checks syntax for console access, code evaluation and HTML
sinks. It detects stale generated files and dangling exports and enforces minified gzip size budgets.
Source lint rules keep the package independent of Passport application code and
confine SDK, React and QR encoder imports to their adapters. Workspace checks cover its tests and
build without adding package code to the Passport deployment.

## Size budgets

Entry sizes include static relative imports and the full closure of dynamically imported modules.
Only lazy targets that are separately budgeted entry points are excluded from the importing entry.
Every import target is checked for existence and import policy. The React entry excludes code shared with the
core entry, which is budgeted once. The ceilings are 12 KB core, 22 KB element, 5 KB QR and 3 KB React.

## Development

Run `pnpm --filter @pubky/passport-client test` for unit tests, or `pnpm check` at the repository root
for the complete workspace checks.
