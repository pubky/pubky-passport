# Adding identities and creating accounts

Passport serves the same signer at `/` and at `/authorize`, the only path that accepts a request. A
client starts its normal Pubky SDK authorization flow and opens Passport at
`/authorize#d=${encodeURIComponent(flow.authorizationUrl)}`; a request sent to `/#d=…` is forwarded
there, and `/authorize` without a request returns to `/`. The exact validated request stays in
memory while the user switches identities, imports a backup, or creates an account. Passport never
creates a replacement client request.

The shared **Quick & easy signing** screen opens on first use and from **Switch identity → Add
identity**. It offers Google, backup import, account creation, and Pubky Ring: **Use Pubky Ring**
hands a pending app request to Ring, and without a request **Connect Pubky Ring** adds an existing
Ring identity. Google begins from that screen;
**Create account** opens the provider's enabled SMS, Lightning, and manual invite options.
`PASSPORT_PROVIDER_CONFIG_JSON` controls which methods and provider terms are displayed.

SMS and Lightning verification use the homeserver returned by Homegate. A manual invite can name any
homeserver the user has an invite for: the homeserver field is prefilled with the provider's
homeserver, `PUBKY_SIGNUP_HOMESERVER`, when the instance sets one, and **Change homeserver** accepts
any other valid Pubky public key. The homeserver is shown above the invite code field, so the user can
choose it before entering a code: a well-formed code is looked up on the prefilled homeserver as soon
as it is entered, and on a homeserver the user entered only after they confirm it with **Done**. When
a homeserver does not recognize the code, Passport suggests **Change homeserver** for an invite from
another homeserver.

`PUBKY_SIGNUP_HOMESERVER` is optional and validated at startup. It has two further uses: provider
storage descriptions and upgrade links appear only for identities on that homeserver, and **Republish
homeserver** points a missing `_pubky` record at it. An identity created in this browser, or
imported by publishing its missing record, remembers that homeserver, and repair offers only that
one; the provider's homeserver is the fallback for other imports, Google restores and identities
saved by older builds. There is no default homeserver: without the variable, manual invites ask the
user for one, and republishing and storage copy stay hidden.

Manual invite codes must have the homeserver token form `XXXX-XXXX-XXXX` (Crockford base32; input is
trimmed and upper-cased). Passport never sends a partial or malformed code anywhere. A well-formed code
is looked up with the read-only `GET /signup_tokens/{token}` on its homeserver: `used` and unknown
(404) codes are blocked. When the homeserver cannot be resolved or reached, or gives an unexpected
answer, Passport says it could not check the invite and asks the user to check their connection and
the homeserver key; the user may still continue, and the homeserver verifies the invite at signup.
This lookup and Ring's `pubkyauth://direct_signup?…&st=…` link are the two places the protocol
requires the invite in a URL.

## Homeservers Passport can reach

An identity always uses the homeserver its key's PKARR record names, and the browser resolves that
record at run time to an HTTPS origin, including any port. So the Content Security Policy of both
signer pages, `/` and `/authorize`, allows any HTTPS origin in `connect-src` (not `ws:` or `wss:`):
the browser can reach every homeserver for signup, sign-in, backup import, profile reads and writes
and Ring profile grants, and an app's request can bring its own relay. No operator list is needed; earlier releases
required `PUBKY_HOMESERVER_CONNECT_ORIGINS`, which Passport no longer reads. Remote images stay
limited to Google avatars; profile avatars are read through the SDK and shown as `blob:` URLs.

Pages without the signer, such as the legal pages and the not-found page, reach only Google,
Homegate and the PKARR relays.

## Invite destinations

After SMS/Lightning verification or manual invite entry, the user chooses where the new key lives:

- **Use Pubky Ring.** Passport shows a distinct `pubkyauth://direct_signup?hs=…&st=…`
  signup QR/deeplink, with installation help available separately. After creating the account,
  **Continue to profile** asks Ring to approve a separate limited grant for Passport's profile
  editor. Only a returned SDK session proves control. Ring returns nothing from the signup, so
  Passport cannot know the new key: it shows the pubky Ring connected and asks the user to confirm
  that it is the one just created. Only then does it add the Ring identity to the catalog; **No,
  choose again in Ring** closes that grant and starts a new request. Passport stores the public key
  and setup status, never the private key or grant. The user publishes their profile before
  completing setup. The client's original request still needs explicit approval in Ring;
  connecting the profile does not authorize the client.
- **Keep in Passport.** Passport generates one SDK key, requires a `.pkarr` download protected by
  a password entered twice, then offers a file check: select and decrypt that backup to confirm
  the public key matches, or explicitly **Skip this check (not recommended)**, offered below the
  primary action. Passport registers, publishes, verifies sign-in, and stores that same identity
  locally, recording whether its backup was checked or only created. An uncertain attempt can be retried with the same key; no
  replacement identity is generated. Each attempt first looks the invite up on its homeserver
  (read-only); when the homeserver does not answer, Passport submits and publishes nothing, says
  the homeserver could not be reached, and offers the retry. A first attempt that stops there
  leaves the invite unsubmitted, and **Start over** then discards the key without the confirmation
  for a key that may own an account.

Local setup saves the unfinished key, its bound invite, and its backup step in browser local
storage. Back from verification returns to backup creation, and a reload keeps the saved key:
**Create account** reopens it at the signer choice. Back from backup creation, choosing Ring, and
**Cancel** discard a key whose invite has not been submitted yet; the invite stays in the flow, and
choosing Passport again prepares a fresh key. The draft stays outside the signing catalog until
registration and sign-in finish; successful completion removes the draft. Backup passwords and
file selections are not persisted, so resuming verification requires selecting and decrypting the
backup again; skipping is offered only right after a download in the same session. Once a signup
attempt starts, its key and invite stay bound, including uncertain outcomes and retries, and Ring is
no longer offered for that invite. **Start over** after such an attempt drops the key and looks the
invite up again: `used` or not found forgets it, and when the lookup fails, both signers look it up
once more before using it.

An SMS verification or a Lightning payment costs the user something, so Passport keeps what Homegate
returned in browser local storage: the open Lightning invoice until it is paid, and the issued invite.
**Cancel**, a reload, or a closed popup does not lose either; **Create account** reopens at the signer
choice with the saved invite, or at the invoice while it is still open. Phone numbers and SMS
challenges are never stored. The invite is removed once an account uses it, when the homeserver
rejects it or reports it used, or when the user chooses **Discard invite** and confirms. An account
created with a different invite leaves it saved. An invoice is removed only once it pays for an invite
or Homegate no longer knows it: an SMS invite leaves an earlier invoice saved, since it may have been
paid too, and Lightning offers that invoice again once the invite is gone. An expired invoice is checked
for a late payment before a new one is created; a replacement is charged only when Homegate confirms
the old invoice unpaid or no longer knows it. Manual invites are not stored unless a Passport key is
prepared for them.

Ring signup also returns to signer choice without discarding the invite. An invite that was shown to
Ring, or restored from an earlier visit, can still be used in Passport unless the homeserver lookup
reports it `used` or not found (404); if the homeserver cannot be reached, Passport continues and the
homeserver verifies the invite at signup. A restored invite is also looked up before Ring is shown it:
not found blocks it, and `used` skips the signup QR and goes straight to connecting the Ring profile,
so an account Ring already created can finish setup. Both signers use the same **Create account**
entry: obtain an invite, then choose Ring or Passport. Choosing Ring displays the signup QR.
External authorization with Ring is offered only for a validated client request.

Without a request, **Connect Pubky Ring** on the add screen adds an identity that already exists in
Ring, with no invite. It asks Ring for the same profile grant as profile editing and saves whichever
pubky approves, without setup and without writing anything: an existing profile stays as it is
until the user edits it.

The pending **Signing in to…** context remains visible during either path. Account, key backup,
and profile steps have a shared progress indicator. New accounts stay in setup until their
`/pub/pubky.app/profile.json` is successfully published. Completion then returns to the original
permission review for explicit approval. Without a pending request, completion opens the selected
identity overview. Google completion still requires the user to
choose **Continue**; local registration and profile publication must finish before returning.

**Download backup** in identity management uses the same password and file-check screens, and the
password is entered twice there too. Verification decrypts the selected file and compares its
public key with the selected identity, without signing in or importing another identity. Back
returns to the password screen; successful verification or skipping the check returns to
management. A backup requested by the removal confirmation cannot skip its check, because the key
is deleted next.

Each browser-held identity records, without any file contents, when Passport last made a backup
file of its key and when it last saw one open with its password; importing a backup counts as a
checked backup. The status is stored under its own `local-identities/v1/identity-backup/<pubky>`
key, beside the identity record, so a rolled-back build (which rejects records with unknown fields)
still lists the identity. **Manage identity**, the overview and the logout confirmation show that
status, and offer **Check backup** for a file that was never checked. Only Pubky Ring, a Google
Drive copy or a checked file counts as protecting the key: Passport cannot see what the browser did
with a file it made, so a download that was cancelled, or a backup screen left with Back, changes
nothing. A browser key without such protection is not logged out of but removed: **Remove key from
this browser** warns that it may delete the only copy and offers the backup (and, for an unchecked
file, its check) first. Logging out of an identity protected only by a checked file still asks the
user to confirm they have it.

**Use in Pubky Ring** shows the secret-bearing migration QR code only after **Show QR code**, next to
a warning that the code contains the private key, and withdraws it when the page is hidden or the
layout changes. The key stays in the browser afterwards.

## Client contract

There is no separate signup callback protocol. Clients must keep waiting on the SDK flow they
created before opening Passport. Only the SDK `Session` authenticates the user. Passport's existing
authorization outcome message remains a UI/transport signal and never substitutes for the SDK
result.

For a Ring identity already saved in Passport, **Manage identity → Edit profile** connects Ring
through Passport's own profile grant. It requests write-only access, `/pub/pubky.app/profile.json:w`,
`/pub/pubky.app/files/:w`, and `/pub/pubky.app/blobs/:w`, because profiles and avatars are read
publicly; after approval Passport checks that Ring granted at least these. The screen, its QR code
(**Pubky Ring profile connection QR code**) and its link (**Connect in Ring**) are labelled apart
from an app's sign-in request. Failures after Ring approved say so: the homeserver could not be
looked up, or it refused the grant (an authentication error, `401` or `403`, which the relay never
returns). Other failures cannot be attributed: the SDK reports a transport failure alike for the
relay and for the homeserver, and a status such as `404` may come from the relay (an expired entry)
before any approval as well as from the homeserver after it, so the message names both.

The delegated session stays in page memory for the page session, so further edits need no new
approval; after a reload editing asks Ring again. Passport revokes the grant (`session.signout()`)
when it closes the connection inside the page: when another connection replaces it, when the
identity is removed, when a write is refused, and when the connection screen is left (for example
with **Back**) after Ring approved but before the connection completed. Closing or reloading the tab
does **not** revoke it: Passport starts the revocation on page hide, but the page is gone before it
completes, and no revocation reached the homeserver in a reload test. The grant then stays valid on
the homeserver for its lifetime (two years), although no one holds its session any more, and
neither Passport nor Ring can list or revoke it. Disposing a connection also deletes the SDK's
delegated keys from the browser (`browserSessionStore.clearAll()`), including those of abandoned
requests, so they do not accumulate in IndexedDB. A Web Lock held by every open profile grant keeps
one Passport tab from deleting a key that another still signs with. Whether Ring and the homeserver
accept write-only scopes has not been verified on a device; test it before release.

With an app request, **Use Pubky Ring** on permission review or the add screen opens a separate
sign-in screen with the original validated `pubkyauth` URL unchanged. For a selected Ring identity,
the review shows one action, **Continue in Pubky Ring**, and says that the identity is chosen in
Ring: Passport cannot make Ring sign with the one it shows. An active Ring identity whose profile
setup is unfinished opens this review first; Passport's own profile request waits until no request
is under review. Compatible Pubky signers can use the same QR. Mobile users can open Ring directly
or optionally show the QR. Back returns to the originating screen. Opening Ring does not send an
authorization outcome. Passport cannot see Ring's approval, so the screen tells the user to return
to the app after approving, and **I approved in Pubky Ring** ends the review with the request's
`success` callback, a hint like every outcome: the popup closes after an acknowledged message, or
the page follows the validated `x-success` URL. Without callbacks Passport shows **Return to the
app.** and never reports the request as approved. Passport keeps that URL out of persistent
storage, logs, and general UI state; reloading setup does not restore a scrubbed request URL. If it
expires while setup is in progress, a locally completed identity remains saved, but the client must
start a fresh SDK authorization flow.

## Verification availability

Passport checks the configured Homegate from the browser, so proxy regional rules see
the user's location. These checks never send SMS, create invoices, or request invites:

- SMS: `GET /sms_verification/info`, expecting 200 with an empty body.
- Lightning: `GET /ln_verification/info`, expecting 200 with a positive integer `amountSat`.
- Google: `GET /google_verification`, expecting 405 from the POST-only route. There is no
  Google `/info` endpoint. Google also requires a configured Passport client ID and enabled
  provider setting. Disabled methods are not probed.

A 404 hides the method. A 403 displays the disabled regional-restriction card from the
[Figma design](https://www.figma.com/design/01ZvjSPZnKTNmaEWz0yJsq/Pubky-SHADCN?node-id=41492-356648).
Google is the exception: its probe governs only creating new Google identities, because restoring
an existing identity from Drive never calls Homegate. **Continue with Google** stays available
whenever the provider enables Google and a client ID is configured. A 403 adds a note that new
Google identities are not available in the user's country, and a 404 adds nothing. If Drive
holds no identity and Homegate then refuses the signup token, the Google error screen reports it.
Before the encrypted backup of a new Google identity is written to Drive, Passport looks Homegate's
invite up on its homeserver (read-only). When the homeserver does not answer, or reports the invite
used or unknown, creation stops with nothing written to Drive and no record published, so when the
homeserver did not answer before signup, trying again creates the identity instead of restoring a
key that owns no account. A restore that must repair a missing homeserver record makes the same
check and publishes no record for a homeserver that does not answer. Each Homegate invite spends
one of the Google account's verifications (by default two a week), so Passport keeps an invite no
signup has used in page memory for that Google account and uses it on the next attempt instead of
requesting another; a signup attempt or a used or unknown answer drops it. The check does not cover
a signup that fails after the homeserver answered the lookup, for example a connection that drops
mid-signup: the identity's record may already be published, and a later restore then ends in a
sign-in failure instead of repairing the account.
Network/CORS errors, timeouts, unexpected statuses, and malformed Lightning information
leave availability unknown and offer a retry; they are not labelled as geographic blocks.
Manual invite entry remains available, including while discovery is pending or fails.
Action errors retain their own meaning: a 403 during SMS submission may mean the phone
number is blocked, not that the user's country is restricted.

Google detachment removes the Drive backup and association while keeping the selected
identity and its key locally. Local-key identities without a Google association can use
**Manage identity → Google account → Attach to Google**. This enables Google sign-in by
backing up the existing key. Attachment checks Drive metadata only and stops if any Passport
backup already exists; it never downloads, decrypts, or overwrites that backup. Ring-held keys remain in Ring.

## Validation

Automated SMS and Lightning coverage uses mocked Homegate responses; it must not send live texts or
payments. Ring signup, subsequent authorization, and the write-only profile grant (Ring's consent
and the homeserver's acceptance of `:w` scopes) require a separate device test.
Run `pnpm check` and `pnpm test:e2e:run` before shipping.
