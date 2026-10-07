# @pubky/passport-client: design notes

How the package works inside, for people changing it. Apps need only the [README](./README.md)
and the [integration guide](../../docs/integration.md).

## Configuration and errors

Configuration defaults to identity-only capabilities and a required Pubky profile; broad
capabilities are always refused. Browser-derived names are resolved on the first browser
operation, and a same-tab request's callbacks are built once from the page's path. App names follow
Passport's source-character rule: joiners used in multilingual spelling and emoji are accepted;
controls, bidi controls and zero-width spaces are rejected. Configuration errors name the invalid
option without echoing its value.

Runtime errors expose stable codes and text-only copy that apps can override. Their causes contain
only a recognized SDK error name (or `UnknownError`) and an optional HTTP status, never the original
SDK error; the internal detail behind a code is not public. Sign-in reports `request_ended` when
Passport completes a request without sending an outcome, except while the person is approving in
Pubky Ring, when SDK polling continues. The default idle label says "Continue with Pubky"; later
steps and the instance picker name Passport.

## Build checks

The build checks the private manifest, peer versions and import locations, rejects unsafe API
tokens in minified output and checks syntax for console access, code evaluation and HTML sinks. It
detects stale generated files and dangling exports and enforces minified gzip size budgets. Source
lint rules keep the package independent of Passport application code and confine SDK,
`pubky-app-specs` and QR encoder imports to their adapters. Workspace checks cover its tests and
build without adding package code to the Passport deployment.

## Attempt runtime

The internal attempt runtime navigates with a flow's own pinned instance and sends every message to
that exact origin. It rejects a mismatched navigation origin before reading the private flow URL.
Replies must match the current window and origin, plus the attempt ID for v2; legacy v1 outcomes
use the window and origin checks. Replacing a window immediately unbinds its predecessor, including
while a fresh flow is still being created. An outcome only changes progress; only a
capability-checked SDK Session can authenticate. Ending an attempt removes its message listener and
window watch and closes its popup. A poll already in flight is allowed to settle before its handle
is freed, so a late Session keeps its original flow's delivery or revocation rules.

`tryPollOnce()` never reaches the relay itself: the SDK keeps one long-poll open in the background
(the relay ends it after 25 seconds and the SDK opens the next) and the call only looks whether it
brought the answer, which it does at once (measured against `httprelay.pubky.app` with SDK 0.11
and 0.12). The client therefore waits 300 ms after an empty look, 1 second while the page is
hidden, so it never spins and an approval still shows within a third of a second. A failed look
ends the flow; the attempt decides about a retry.

The click router opens Passport synchronously. If the browser returns `undefined`, it retries once
with `_blank`, preserving the exact URL and window features. A non-live retry keeps the
callback-free flow available through the relay; it never triggers the same-tab route. Only a
blocked first call continues in the same tab, and only when the page is top-level, HTTPS and can
write `sessionStorage`; in-app browsers, iOS home-screen web apps and cross-origin-isolated pages
take the same tab straight away under the same conditions. The activation diagnostic is returned to
the caller for delivery after it owns the window, without exposing the request URL.

The popup actions reserve the sign-in result before opening, so reentrant calls reuse the same
promise. Cancelled or otherwise unclaimed windows are closed. A queued click finishes its ownership
check and diagnostic only after its controller event runs; a Session observer can start a new
attempt without the previous click closing its window or settling its result. Reopen keeps the flow
and pin, while the default-instance action opens a blank window for a fresh default flow. Before
flow creation finishes, another click only focuses a live window; if that window has closed, the
closure watcher ends the attempt and Retry creates a fresh flow. Once the opening window has a
flow, a click can replace a closed handle: it obtains a live replacement first, then processes
closure and reopens with the same URL, attempt and result. An unsuccessful native retry changes no
state.

## Sessions and profiles

The Session receiver claims ownership before inspecting SDK metadata. A handle already seen by that
client is never inspected or delivered again. An unreadable snapshot triggers sign-out, one retry
after two seconds if it fails, and handle cleanup on every outcome. Its error uses sanitized SDK
metadata and the original flow's instance. A readable Session must still match the requested
capabilities before delivery. Diagnostic observers cannot interrupt this cleanup.

The profile step holds each capability-checked Session until one public SDK read of
`/pub/pubky.app/profile.json` settles (at most 64 KiB, 15 seconds), then validates the document
with `pubky-app-specs` (loaded on first use); a document that fails validation counts as no
profile. With `profile: "required"` a missing profile or failed read keeps the Session private and
retries every five seconds while visible, and on focus or return to the page; with `"optional"` the
Session is delivered with `profile: null`. Cancel, timeout and disposal revoke a held Session. A
pop-up or same-tab request tells Passport the requirement (in the hello, or as `profile=required`
next to `d=`). After a Pubky Ring sign-in through Passport's window, a bound Passport that
advertised `profile-setup` is asked once (`profile-needed`) and its `profile-ready` triggers quick
rereads. A Pubky Ring QR sign-in from the large element does not pass through Passport and relies on
the package's own check. While a prepared keychain request is held (a large element's lease), every
hello carries the `keychain` feature, so Passport does not offer a second keychain route on its
request Join; it is a display hint only. The SDK read may finish later; its result is ignored after the attempt ends
and its storage wrapper is freed when the read settles. Real homeserver profile reads and Ring scans
remain unverified.

## Same-tab state

The same-tab flow is created with callbacks on the page's own origin and saved with the SDK's
delegated save: the proof-of-possession key stays non-extractable in IndexedDB, and the saved
string, which still carries the request's relay secret, goes into the initiating tab's
`sessionStorage`. A browser that cannot hold delegated state cannot continue in the same tab, and
neither can a classic QR (legacy cookie) flow: the SDK's cookie `AuthFlow` has no delegated save,
so the resume path (`resumeDelegatedGrantAuthFlow`) is never taken for it and a blocked pop-up in
classic mode fails as `popup_blocked` while the in-page QR code keeps working.

## Classic QR

Pubky Ring before 2.0 approves only the legacy cookie sign-in. The flow adapter reads the client's
per-device choice (`pubky-passport-client/keychain-auth/v1` in the app origin's `localStorage`) at
every start: `grant` (the default) calls `startGrantAuthFlow`, `cookie` calls
`startCookieAuthFlow(capabilities, kind, httpRelay, xCallback)` with the same capabilities and
callbacks, without a client ID or PoP key. One flow serves the QR code and Passport's pop-up, so the
choice shapes both. Switching dispatches `RING_RELOAD`, which rotates a prepared (`ready`) flow and
leaves a running attempt alone. The delivered cookie `Session` goes through the same capability
check and profile read as a grant session.
Creating that flow ignores its result after cancellation, replacement or Session delivery, and does
not navigate, poll or free the saved flow.

The record holds the attempt ID, the Passport origin (validated again when read; loopback only for
the client's default) and the SDK's saved state. It belongs to the client that wrote it, identified
by a fingerprint of its app name, capabilities, client ID, instance and profile, and is eligible for
30 minutes; future timestamps are ineligible. A one-time startup sweep can discard another client's
well-formed record only beyond that bound or when future-dated. A valid return marker suspends the
sweep so return handling can tell a bad record from a missing one. Cleanup failures never expose
stored state or native exception text. If the system clock goes back past the redirect's start
time, that sign-in ends with `resume_failed`, and the person starts again.

The native hand-off saves and reads back the record, sets `window.opener` to null and verifies it,
then assigns the fragment URL in one task. Only after assignment returns does sign-in resolve
`redirecting`. Refused opener severance or navigation returns a constant `internal` error and
deletes the owned record. Queued cancellation prevents a later native commit; a queued popup click
can apply only while its original sign-in result is still pending.

The return reader confirms deletion with a storage read before handing saved state to resume. A
failed deletion or a non-empty or failed read-back stops resume. It scrubs a valid return marker
separately and preserves another client's record and URL; without a marker it leaves the app's own
`errorCode` and `errorMessage` parameters alone. If the browser refuses `history.replaceState`, the
`pubky-passport` parameter stays in the address bar; it holds no secret. A reload of that stale
marker has no saved record to consume.

## QR code

The pinned Project Nayuki encoder is vendored under its MIT license.
[Third-party notices](./THIRD_PARTY_NOTICES.md) record its exact source and SHA-256; tests reject
any upstream byte change or change to the two permitted wrapper lines.

The large element renders the Ring QR as an accessible SVG in a closed shadow root, using one module
path, Pubky Ring's logo over its centre as Passport draws it (48 of the code's 176 units, at error
correction H, which restores the covered modules), and a quiet zone, with
`createElementNS` and no HTML parsing, data URLs or network requests. It is always dark modules on
white, whatever the page's theme, framed as Passport frames its codes. The link stays in the closed
root: a click copies it, and nothing else reveals it. A link that can no longer be used is replaced
by a blurred stand-in that does not encode it, so a dead request is never scannable.

A long `appName` or `clientId` makes the QR denser. The SDK percent-encodes the request, so each
non-ASCII `appName` character costs 9–12 bytes. Tests compare rendered module grids with the
untouched upstream encoder, compiled independently (see `test-vectors/qrcode.md`). The element's QR
cutoff is 2,331 UTF-8 bytes; a link too long for H (over 1,273 bytes) is drawn at M without the
logo, and above the cutoff the keychain app can only be opened through "Open keychain app" on the
same device.

## Instance choices

Instance choices (the element's "Use a different Passport") belong to each app's origin and are
never shared across apps. The canonical URL rules are the vectors in
`test-vectors/instance-origin.json`; future Passport operator-URL checks must pass the same vectors.
The `instance` option and people's choices require HTTPS domain origins, excluding IP and localhost
addresses (only the package's own tests may use loopback). A choice is stored as the bare origin,
revalidated on each read, and storage failures fall back to page-local memory; choosing the default
clears it. Domain labels use ASCII letters, digits and interior hyphens after URL punycode
normalization, with a 63-character label limit and 253-character host limit. Port zero is rejected.

## Limitations

Abandoned sign-in attempts can leave one non-extractable, pending proof-of-possession key per
attempt in the browser's `pubky-auth` IndexedDB database. It cannot be exported, is useless without
the flow's relay secret, and is not cleared by this package. The package never calls
`browserSessionStore.clearAll()` or accesses SDK stores directly. Apps that own their origin's
Pubky state may call the SDK's `clearAll()` themselves at sign-out.

## Size budgets

Entry sizes include static relative imports and the full closure of dynamically imported modules;
peers (the SDK and `pubky-app-specs`) are not counted. Every import target is checked for existence
and import policy. The planned ceilings were 12 KiB core and 22 KiB element; the build allows a
provisional 32 KiB (`index.js`) and 42 KiB (`element.js`) gzip until the maintainer decides, and
`scripts/checkDist.mjs` prints the measured sizes. Measured for artifact app.8: `index.js` 28,949
bytes and `element.js` 41,863 bytes gzip; collapsing the settings tray's empty hint cost the
element 8 bytes (41,855 in app.7), 1,145 bytes under its budget.

An app signs in through this package alone: its runtime dependencies for sign-in are this package
and its two peers.
