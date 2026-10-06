# How Passport handles a sign-in request

This page describes Passport's own screens while it answers an app's sign-in request. Apps do not
need any of it to integrate: the [integration guide](integration.md) covers what your app does.
Account creation and identity management are in
[Adding identities and creating accounts](signup-integration.md).

## Opening a request

Passport opens a request in two steps. Only identities whose key the browser holds count here: an
identity whose key stays in Pubky Ring is saved in Passport for its profile only, is never listed
for a request, and signs through **Continue with Pubky Ring** alone. With exactly one such identity
(and active) the request opens straight on that identity's permission review; so does a request a
user enters by hand from an identity's overview (**Authorize**), which opens on that identity's
review. Otherwise it first lists those identities. The list and the review both end with the same
"or": **Use another identity** and **Continue with Pubky Ring**. **Use another identity** opens
the start page, keeping the request; **Back** returns to where it was opened.

The start page is two cards and a quiet link: **Create account** with the ways to verify that the
instance's Homegate offers as buttons (**Continue with SMS**, **Continue with Lightning**,
**Continue with Google**, and **Enter invite manually**), **Pubky Ring**, and **Have a recovery
file? Import it**. Without an identity Passport can sign with (nothing saved, or only Ring
identities) the request opens on that start page under the heading **Signing in to {app}**, and its
Pubky Ring card holds **Continue with Pubky Ring**; opened through **Use another identity** the card
is left out, since the screen before it already offers Ring. (Without a request the card holds
**Sign in with Pubky Ring**, which adds an existing Ring identity inside the card.)

Every step names the app the way permission review does: with its callback host when its
`x-source` label differs from it, or with a notice when the request has no callbacks. The list
reads no profiles: it shows the names and avatars kept from earlier reads. Choosing an identity
opens the permission review: **Cancel** in the header (as on the list), **Authorize** as the one
action under the request, then the "or". **Switch** on the identity's card leads back to the list
and is shown only when more than one identity can sign. An identity with an attached Google account
shows it, and one without a public profile is named after its key. Switching identities or
creating an account preserves the original request; a new account is asked for its public profile
once, and **Skip for now** there goes on to the review, unless the app requires a profile (see
[Requiring a profile](#requiring-a-profile)).

## Permissions

A request for broad access (for example `/:rw`, or `/pub` and `/priv` with or without their
trailing slash, which reach every app's folder) is flagged on the list, on the request's start page
and on the Pubky Ring screen as well as on the review, where its primary action names what it
gives, such as **Allow changing all your data** or **Allow reading all public data**, and the
sentence above it says the same. Each permission shows a plain title above its exact path, and
tells the app's own folder (`/pub/<callback host>/`) from the folders of other apps. Namespaces
people know by their product get their names and a short line on what they hold: the Pubky App's
known folders by what is in them (**Your posts**, **Your public profile**), `/pub/pubky.app/` and
`/pub/social/` as **Your public Pubky social data**, `/priv/social/` as **Your private Pubky social
data**, and `/priv/app.locks/` as **Your Locks content** (private content shared only with paying
or approved people), never as social data or by its folder name; a narrower path reads **Part of
…**. Any other folder keeps the generic title with its name quoted. A long list
folds away only entries in the app's own public folder; broad entries, the Pubky App's folders,
private folders and other apps' folders always stay in view, and a request without callbacks never
folds. Local approval always requires an explicit **Authorize** (or **Allow …**) action.

## Continue with Pubky Ring

**Continue with Pubky Ring** hands the app's request to Ring unchanged, and the user picks the
identity in Ring. On a phone or tablet (a coarse pointer) it follows the `pubkyauth://` link at
once and keeps one **Open Pubky Ring** button in place to open it again with the same request,
never a QR code (a phone cannot scan its own screen; the store badges under it are there for a
phone without Ring). With a mouse or trackpad (a fine pointer, such as an app's desktop popup) it
shows the QR code directly, since a computer cannot open the link. Pressing the QR code copies the
request link (the same `pubkyauth://` link Ring would open) to the clipboard.

When Ring runs on the same device, it opens the request's `x-success` URL itself after the
approval, so the user lands back in the app. The screen has no button to report an approval; its
only control is **Back**. Passport goes on by itself: an app bound over
[Opener protocol v2](integration.md#opener-protocol-v2) gets Ring's answer through its own SDK and
closes Passport's window; wherever Ring runs, Passport also watches the app's relay channel and
ends the Ring step once Ring's answer is there (what it then tells the app is described under
[Outcome messages](integration.md#outcome-messages)). When there is no app page or callback to
hand back to, Passport goes on to its own home. Where it can do neither, the screen stays until
the app closes it.

## Outcome screens

When the answer cannot reach the app through a callback or a message, Passport ends on an outcome
screen: an approval, a cancellation, an approval that did not reach the relay (the user starts
again in the app), or an identity whose key could not be unlocked in the browser. It names the app
only when the request has callbacks, beside their host; the `x-source` label alone never names it.
A request that expired before Passport loaded is told apart from a link that cannot be used. Each
of these offers **Close window** in a popup; in a tab of its own, the expired and invalid screens
go **Back to the app** when the app's page sent the user there, and the others offer a way to
Passport's start page. If the browser blocks Passport's storage during a request, Passport offers
**Continue with Pubky Ring** beside **Cancel**. Opening `/` without a request shows the selected
identity overview, or the add screen on first use. An unfinished local account setup resumes its
saved key and backup step after a reload.

## Editing a profile from an app

`/#edit-profile=<key>` opens the profile editor of that one identity; the app links to it, in a
pop-up or as a plain link (`target="_blank"`). The fragment must hold exactly that parameter, a
z-base-32 key, and nothing else; any other shape (another parameter, a repeat, a query, a `pubky`
prefix) shows **Invalid profile link.** with **Go to Passport**. The address is cleared before the
page renders.

- A key this browser holds: its editor opens directly (no setup steps, no skip); **Back** goes to
  Passport's home.
- A key in Pubky Ring that Passport has saved: Passport asks Ring for its write-only profile grant
  for that key first, as from the identity's overview.
- A key Passport has not saved: the same Ring connection, with a note that this pubky is not saved
  here; only Ring's approval of exactly that key saves it and opens its editor. Ring approving
  another key is refused ("Pubky Ring approved a different identity…") and nothing is written.

Passport never edits another identity than the link's. Saving writes `profile.json` and the avatar
files only, then shows **Profile updated.**; an app whose v2 hello named the key
(`editProfileKey`) hears `profile-updated` with that key, sent to its own origin only. A plain link
has nobody to tell, and the app reads the profile again itself.

## Testnet instances

An instance with `PUBKY_NETWORK=testnet` shows a **Testnet** badge beside the logo on every page,
so its identities and sign-ins are never taken for real ones. It refuses a request that names the
main network, next to `d=` (`network=mainnet`) or in the app's bound hello, before showing it:
the screen reads **Different network.** and says which network the app and this Passport use, and
the app's pop-up hears `ready` with `request: { status: "invalid", code: "network_mismatch" }`. A
mainnet instance refuses a testnet request the same way. A request that names no network (a plain
link, an older client) is not checked.

## Leaving a pending request

While a request waits in a tab of its own (a same-tab request, or a popup whose opener has closed),
Passport asks the browser to confirm before the page is reloaded, closed or navigated away, because
leaving drops the request without an outcome message; the request itself is never stored, so it
does not survive a reload. A popup the app's page opened is never guarded: the page owns it and may
close it at any time without the user seeing a prompt, for example once Pubky Ring's session
arrives through the relay, at its attempt deadline or on its own cancel. While a request is
pending, the footer's legal links open in a new tab and the logo is not a link. If the browser
restores a page that was left mid-request from its back/forward cache, Passport says the request
has closed and offers **Close window** (or, without an opener, a way back to Passport) instead of
showing actions that could no longer answer the app.

## Who is asking

Passport names the requester only when it can verify it: an app's popup whose v2 hello bound this
exact request names its opener's browser origin (punycode and non-default ports included; an HTTP
loopback opener reads **Local development app ({origin})**). The top band then says **Signing in
to {host}** while the request waits and **Sign-in request from {host}** on its outcome screen; the
heading is **Signing in to {label}**, with **Website: {callbackHost}** beside a label that differs
from it, and a long permission list may fold the rows of the app's own folder
(`/pub/{callbackHost}/`, only when the callback host is the opener's origin). No text or badge says
the opener is "verified": the band names the browser origin that opened Passport, which does not
make the app trustworthy.

Without a bound opener (a plain link, the same-tab flow, or a popup whose hello never bound the
request) Passport cannot tell who sent the request, and every screen says so instead of naming
anyone. The band reads **Passport can’t confirm who is asking.**, with **Returns to {callbackHost}
(unverified)** when the request has callbacks; the heading is **Sign-in request.**, on one line
where it fits, with the request's `x-source` shown only as **Name in the request: {label}
(unverified)**; one warning line, **Passport can’t confirm who sent this request.**, sits right
above Authorize (it gives its place to each step of the answer once Authorize is pressed), as on the
identity list and the Pubky Ring hand-off, and the sentence over it asks to continue only if the
person just started this sign-in; sentences say "the app"; no permission row is called the app's own
data and none is folded; window titles read **Sign-in request**; and outcome screens name no app. A
page with an opener waits up to one second after it loads for that hello, showing the neutral
heading without the band or the warning; a hello that binds later updates every surface. `/` (a
reloaded popup or a request entered by hand) never binds a requester, whatever hellos arrive.

When the callback origin differs from the bound opener, both surfaces warn: **This app asks to
return you to {callbackHost}, which is not {openerHost}.** Hosts include non-default ports and
remain text. The comparison uses the full origin, including the scheme. The warning does not
invalidate the request or disable approval; outcomes still go to the bound opener first.

## Google sign-in in the same tab

**Continue with Google** opens Google's own pop-up everywhere: on Passport's start page, during a
request (also when Passport itself is the app's popup), and in Manage. Passport waits beside it
with **Cancel** and **Show Google's window**; a person who closes Google's window stays on that
screen with **Try again**, and nothing leaves the page. Passport does not start Google by itself;
the start page offers it beside the other ways in.

Only during a request, and only when the browser blocks Google's window (it opens none, refuses,
or hands back one already closed), Passport continues the sign-in in its own tab or window instead,
saying "Your browser blocked Google's window, so Passport continues in this tab." There is no
nested popup. Identities already saved still go to the identity list or the permission review, and
a Google sign-in grants the app nothing without that review. Without a request (Passport's own
start page, and Manage's Google actions) a blocked window ends in an error that asks to allow it.

The round trip uses the existing origin-root callback URI. Before leaving, Passport saves the
validated request (which carries its relay secret), the OAuth state and the nonce's preimage
(Google gets only its hash; see the README on the wrapping key), the operation to continue, and whether the app requires a profile, in the tab's `sessionStorage`, for at most five
minutes. Back on `/` it takes that record (read once, then removed), keeps Google's tokens in
memory only, scrubs the response fragment before hydration, and finishes the Google sign-in
without another press. That page shows nothing else of the request: once the identity is set up,
or the user turns back from a failure, Passport returns to `/authorize#d=…` (with
`&profile=required` when the app asked for one), where the request opens on the review of the
identity just set up. Missing or expired storage fails closed, with a Google error and **Try
again**; when the tab's storage is blocked as well, Passport does not leave and asks for Google's
window to be allowed. An OAuth denial is retryable, and **Back** returns to the request's start
page. Reloading after the callback was consumed requires starting the sign-in again.

In a popup, the app's periodic hello keeps the request bound across the round trip: the callback
page answers `ready` for the request it holds, and `/authorize` binds again when it loads, so the
band keeps naming the app's origin and a profile requirement from its hello is kept. The hello is
not delivered while Google's page is in the window, which needs no handling on the app's side.

## Requiring a profile

An app that requires a pubky.app profile says so in its hello or next to `d=` (see
[Requiring a profile](integration.md#requiring-a-profile)). Before the review, Passport reads the
chosen identity's `/pub/pubky.app/profile.json`, the read the review makes anyway. Found, the review
shows as usual. Missing, or not a valid profile, the profile form opens inside the sign-in, saying
the app needs a public profile; there is no **Skip for now** (a new account's **Account created.**
screen drops it too), and **Back** returns to the identity list, where **Cancel** answers the app.
Once the profile is published, the review follows in the same window. A read that fails shows
**Couldn't read your profile.** with **Try again**, never the review. The request itself is
unchanged.

An identity held in Pubky Ring signs in through Ring, not through this review, so Passport cannot
check its profile before the approval. When the app then asks for the profile (`profile-needed`),
Passport connects its own write-only profile grant for exactly that key: one more Ring approval,
which is what proves the key. Because the person has just approved the app in Ring, that screen
says so: its heading is **Set up your profile.**, and it explains that they are signed in with
Pubky Ring, that the app (named as the sign-in band names it; "this app" on a page reopened without
the request) needs a public profile, and that approving lets Passport create it, with access to the
profile and avatar only. Then comes the profile editor, saying the app needs a public profile, with
no **Skip for now** and no **Back**. Saved, Passport shows **Profile published.** with a **Close
window** action. A key Passport does not know yet is kept as a Ring identity with its profile still
to do, so Passport's home offers **Set up profile** for it later; an identity Passport already has
is left as it is. Passport's Ring grant lasts for its page session, so a window closed during the
editor connects Ring again; entered form data is not kept across the closed window.

Ring profile editing never modifies the app's request or treats opening Ring as a successful
sign-in. A saved Ring identity is never the request's identity, so Passport asks for its own profile
grant only from the identity's overview, or when the app asks for a profile after a Pubky Ring
sign-in.
