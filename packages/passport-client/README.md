# @pubky/passport-client

A popup outcome is a UI signal. Only a Pubky SDK `Session` authenticates the user.

This workspace package is private and under construction. It stays unpublished until the npm
scope is confirmed and `passport.pubky.app` serves `/authorize` with opener protocol v2 and the
verified-requester display. The default instance is `https://passport.pubky.app`.

The package has zero runtime dependencies. The app supplies the Pubky SDK as a peer; React is an
optional peer for the React entry point. It exports `DEFAULT_PASSPORT_INSTANCE`,
`PassportConfigError`, typed runtime errors, default messages, `describePassportState` and the
option/state types; client, element, QR and React behavior arrives in subsequent changes.

Configuration defaults to identity-only capabilities and a required Pubky profile. Browser-derived
names and return paths are resolved on the first browser operation. Advanced timeouts must be
integer milliseconds from 1 through 2147483647. Shortening `attemptMs` also shortens the default
redirect-state lifetime; an explicitly supplied lifetime cannot exceed the attempt timeout.
Undefined timeout fields retain their defaults. App names follow Passport's source-character rule:
joiners used in multilingual spelling and emoji are accepted; controls, bidi controls and zero-width
spaces are rejected. Configuration errors name the invalid option without echoing its value.

Runtime errors expose stable codes and text-only copy that apps can override. Their causes contain
only a recognized SDK error name (or `UnknownError`) and an optional HTTP status, never the original SDK error.
`describePassportState` supplies labels, status, actions and the visible custom-instance notice;
its signed-in view is hidden.
Standalone callers must pass `context.defaultHost` to `describePassportState` when configuring
their own default Passport instance. Error construction uses the attempt's `instance` metadata
to select custom-instance copy and actions.

| Error detail                                          | Meaning                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `request_rejected` with `detail.rejection`            | A Passport parser code, or `empty`; a missing code also means an invalid request. Only `empty` can be retried. |
| `popup_closed` with `detail.handshake: "unconfirmed"` | The popup closed before its handshake confirmed; the view may offer the developer default.                     |

## Security

The build checks the private manifest, peer versions and import locations, rejects the specified
unsafe API tokens in minified output and checks syntax for console access, code evaluation and HTML
sinks. It detects stale generated files and dangling exports and enforces minified gzip size budgets.
Source lint rules keep the package independent of Passport application code and
confine SDK, React and QR encoder imports to their adapters. Workspace checks cover its tests and
build without adding package code to the Passport deployment.

The imported demo temporarily uses the upstream template's `qrcode` dependency,
covered by the workspace production audit. It is separate from this package and
will be removed when the demo adopts the package's QR entry point.

## Size budgets

Entry sizes include static relative imports and the full closure of dynamically imported modules.
Only lazy targets that are separately budgeted entry points are excluded from the importing entry.
Every import target is checked for existence and import policy. The React entry excludes code shared with the
core entry, which is budgeted once. The ceilings are 12 KB core, 22 KB element, 5 KB QR and 3 KB React.

## Development

Run `pnpm --filter @pubky/passport-client test` for unit tests, or `pnpm check` at the repository root
for the complete workspace checks.
