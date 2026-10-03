# Adding identities and creating accounts

> To add Passport sign-in to an app, use the `@pubky/passport-client` button; see the
> [integration guide](integration.md). This page describes how Passport adds identities and creates
> accounts, for people working on Passport itself.

Passport serves the same signer at `/` and at `/authorize`, the only path that accepts a request. A
client starts its normal Pubky SDK authorization flow and opens Passport at
`/authorize#d=${encodeURIComponent(flow.authorizationUrl)}`; a request sent to `/#d=…` is forwarded
there, and `/authorize` without a request returns to `/`. The exact validated request stays in
memory while the user switches identities, imports a backup, or creates an account. Passport never
creates a replacement client request.

The shared add screen (the start page) opens on first use, from **Switch identity → Add identity**,
and from **Use another identity** on a request's identity list or review (or first, when Passport
has no identity to sign with); during a request its heading names the waiting app, backed by its
website or a notice that it names none, as on permission review. It is two cards and a quiet link.
The **Create account** card lists the ways to verify a new account as buttons, without
descriptions, as the instance's Homegate reports them: **Continue with SMS**, **Continue with
Lightning**, **Continue with Google** (which also restores; where new Google sign-ups are blocked
it reads **Restore with Google** and stays usable), and **Enter invite manually** (a quiet "Have an
invite code?" link while other methods are offered, the card's button where an invite is the only
method). A method Homegate blocks in the user's country is disabled with one line saying so; one
whose check failed is left out, with **Check again**. Picking a method opens account creation on
it (the phone number, the invoice, or the invite entry), and **Back** from that first step returns
to the start page; a setup or a finished verification saved from an earlier visit opens instead.
The method list (**Create your account.**, buttons too, with only Lightning's price or the
provider's payment terms under its button) remains inside the
flow for the cases that return to a choice: a verification the homeserver refused, or **Verify
another way** after a rejected invite.
Both start-page cards are illustrated choice cards, laid out as pubky.app's sign-in cards (8px
corners): from 1024px the illustration in a fixed left column, top-aligned with the content, and
beside it one left-aligned stack of the title, a one-line description and the card's actions. In
a card of 36rem or more (a 1280px window's half) the illustration takes about half the card: all
of it the 18rem content column leaves (204px in a 588px card, at most 16rem), 48px from the
content; in a 1024px window's half it is 96px. Both cards share their padding, column widths and
the lines of their titles and descriptions, and stretch to one height. The **Pubky Ring** card holds **Continue with Pubky Ring**
during a request, which hands the request to Ring. Without a request it adds an existing Ring
identity inside the card. With a mouse or trackpad (a fine pointer) the card shows its QR code as
soon as the page is up, with the store badges under it and no waiting line, and nothing to press
or cancel; leaving the page ends the request. The page paints without the
Pubky SDK: a placeholder of the code's size ("Generating QR code…") holds its place until the SDK
has loaded and the request is open on the relay, so the page does not move. On a phone or tablet
(a coarse pointer) the card holds **Sign in with Pubky Ring** and prepares nothing until it is
pressed. One press makes the request and opens Pubky Ring with it as soon as it exists, from a
button that takes the pressed one's place ("Opening Pubky Ring…", then **Open Pubky Ring** to
open it again with the same request), with **Cancel** (which ends the request) and the store
badges beneath it; a phone is never shown a QR code. Nothing moves when Ring opens
or when the page comes back into view. If the browser no longer counts the press by the time the
request exists (a slow first load), Ring opens on the next press of **Open Pubky Ring**. Every desktop visit to the start page therefore opens a profile-grant request on the
relay, which simply expires when nobody scans it. Below the cards, **Have a recovery file?
Import it** opens the import. Where an invite is the only method
(the instance offers neither SMS nor Lightning), the invite entry opens with the
provider's terms and a note on where invites come from; its **Back** leaves account creation. The
phone step says the number is used only to send the code and to limit sign-ups per number, and that
the sign-up service keeps only a one-way hash of it. `PASSPORT_PROVIDER_CONFIG_JSON` controls which
methods and provider terms are displayed.

SMS and Lightning verification use the homeserver returned by Homegate. A manual invite can name any
homeserver the user has an invite for: the homeserver field is prefilled with the provider's
homeserver, `PUBKY_SIGNUP_HOMESERVER`, when the instance sets one, and **Change homeserver** accepts
any other valid Pubky public key. The homeserver is shown above the invite code field, so the user can
choose it before entering a code: a well-formed code is looked up on the prefilled homeserver as soon
as it is entered, and on a homeserver the user typed into **Homeserver public key** only after they
confirm it with **Use this homeserver** or Enter. That field shows the whole key across several
lines. When a homeserver does not recognize the code, Passport suggests **Change homeserver**
for an invite from another homeserver and, where SMS or Lightning can be used, **Verify another
way**.

`PUBKY_SIGNUP_HOMESERVER` is optional and validated at startup. It has two further uses: provider
storage descriptions and upgrade links appear only for identities on that homeserver, and **Republish
homeserver** points a missing `_pubky` record at it. An identity created in this browser, or
imported by publishing its missing record, remembers that homeserver, and repair offers only that
one; the provider's homeserver is the fallback for other imports, Google restores and identities
saved by older builds. That fallback is published only after the user answers **Was this pubky
created on this Passport’s homeserver?**: an account made through Passport may live on a
homeserver entered at signup or named by its invite, so the warning says to choose Yes only for a
signup here without a different homeserver, and to cancel when unsure. Manage shows **Looking up…**
while the record resolves, **No record found** or **Couldn’t check** otherwise, and explains a
record Passport cannot repair (a key held in Pubky Ring, or no homeserver to offer). There is no
default homeserver: without the variable, manual invites ask the user for one, and republishing
and storage copy stay hidden.

**Import recovery file** decrypts a recovery file in the browser and signs in with the homeserver its
key's record names. When that key has no record, the import shows **Homeserver not found.** and
offers **Reconnect and import**, which publishes the record for `PUBKY_SIGNUP_HOMESERVER` under
the same condition and warning; **Back** returns to the form with the picked file kept, where the
browser lets a page put a file back into its picker. If a record appears meanwhile, Passport
changes nothing and asks for the password (and, where the file could not be kept, the file) again.
A failed sign-in or record lookup keeps the password and offers **Try again**, and a file of an
identity already saved in this browser offers **Use this identity**.

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

After SMS/Lightning verification or manual invite entry, Passport asks where the new key should
live, with Pubky Ring listed first as the recommended choice. Once a key saved in this browser has
submitted its signup, there is nothing left to choose: Passport shows **Finish your account.** with
**Continue**, which finishes the registration with that key.

- **Keep key in Pubky Ring.** Passport shows a distinct `pubkyauth://direct_signup?hs=…&st=…`
  signup QR/deeplink in the same Ring card as every other Ring screen, with App Store and Google
  Play links for people without Ring under it, no line saying it waits, and only **Back** to
  press. While it waits, Passport looks the invite up on its homeserver every 3 seconds with the
  read-only `GET /signup_tokens/{token}` (less often while the homeserver gives no answer, down to
  every 30 seconds, and not at all while the page is hidden, looking again as soon as it is
  shown); once that reports the invite used, it goes on by itself. There is no button to go on by
  hand. Ring is then asked to approve a separate
  limited grant for Passport's profile editor. Only a returned SDK session proves control. Ring
  returns nothing from the signup, so
  Passport cannot know the new key: it shows the pubky Ring connected and asks the user to confirm
  that it is the one just created. Only then does it add the Ring identity to the catalog; **No,
  choose again in Ring** closes that grant and starts a new request. Passport stores the public key
  and setup status, never the private key or grant, and the user then publishes their profile to
  complete setup. If the approving pubky already has a published profile, it is not the new one:
  Passport says so (**This pubky already has a profile**) and offers **Choose again in Pubky Ring**
  first or **Add this pubky**, which saves it without flagging setup, clears a setup flag left from
  earlier, keeps its live profile unchanged and says that the pubky just created is not in Passport
  yet. If that profile cannot be read, Passport reads it once more on confirmation and, if it still
  cannot tell, treats the pubky as new; the setup form opens over whatever profile it can read. The client's original request still needs explicit approval in Ring;
  connecting the profile does not authorize the client.
- **Keep key in this browser.** Passport generates one SDK key, requires a `.pkarr` download
  protected by a password of at least 6 characters, then offers a file check: select and decrypt that backup
  to confirm the public key matches, or explicitly **Skip this check (not recommended)**, offered
  below the primary action. Passport registers, publishes, verifies sign-in, and stores that same
  identity locally, recording whether its backup was checked or only created. An uncertain attempt can be retried with the same key; no
  replacement identity is generated. Each attempt first looks the invite up on its homeserver
  (read-only); when the homeserver does not answer, Passport submits and publishes nothing, says
  the homeserver could not be reached, and offers the retry. A first attempt that stops there
  leaves the invite unsubmitted, and **Start over** then discards the key without the confirmation
  for a key that may own an account.

Local setup saves the unfinished key, its bound invite, and its backup step in browser local
storage. Back from verification returns to backup creation, and a reload keeps the saved key:
picking a way to verify on the start page reopens it at the signer choice. Back from backup creation, choosing Ring, and
**Back** from the signer choice discard a key whose invite has not been submitted yet; the invite
stays in the flow, and choosing Passport again prepares a fresh key. The draft stays outside the
signing catalog until registration and sign-in finish; successful completion removes the draft.
Backup passwords and file selections are not persisted, so resuming verification requires selecting
and decrypting the recovery file again; skipping is offered only right after a download in the same
session. The resumed check names the file it asks for and, for a file that is lost, offers **Make a
new recovery file**, which returns to the password step for the same key; the earlier file keeps
working. Once a signup attempt starts, its key and invite stay bound, including uncertain outcomes
and retries, and Ring is no longer offered for that invite. **Start over** after such an attempt
drops the key and looks the invite up again: `used` or not found forgets it, and when the lookup
fails, both signers look it up once more before using it.

An SMS verification or a Lightning payment costs the user something, so Passport keeps what Homegate
returned in browser local storage: the open Lightning invoice until it is paid, and the issued
invite. Leaving with **Back**, a reload, or a closed popup does not lose either; picking a way to
verify again reopens at the signer choice with the saved invite, and **Continue with Lightning**
at the invoice while it is still open. Phone
numbers and SMS challenges are never stored. The invite is removed once an account uses it, when the
homeserver rejects it or reports it used, or when the user chooses **Discard verification** and
confirms. The signer choice after a verification says it worked (**Phone number verified.** or
**Payment received. You’re verified.**) and never calls the Homegate code an invite: when the
homeserver refuses it, **Verification not accepted.** offers **Verify again**, which returns to the
methods with a one-time note that the previous verification couldn’t be used. A refused invite code
offers **Enter a different invite** instead. Passport promises no refund.
An account created with a different invite leaves it saved. An invoice is removed only once it pays
for an invite or Homegate no longer knows it: an SMS invite leaves an earlier invoice saved, since
it may have been paid too, and Lightning offers that invoice again once the invite is gone. An
expired invoice is checked for a late payment before a new one is created; a replacement is charged
only when Homegate confirms the old invoice unpaid or no longer knows it. Manual invites are not
stored unless a Passport key is prepared for them.

Ring signup also returns to signer choice without discarding the invite. An invite that was shown to
Ring, or restored from an earlier visit, can still be used in Passport unless the homeserver lookup
reports it `used` or not found (404); if the homeserver cannot be reached, Passport continues and the
homeserver verifies the invite at signup. A restored invite is also looked up before Ring is shown it:
not found blocks it, and `used` skips the signup QR and goes straight to connecting the Ring profile,
so an account Ring already created can finish setup. Both signers use the same **Create account**
card: obtain an invite, then choose Ring or Passport. Choosing Ring displays the signup QR.
External authorization with Ring is offered only for a validated client request.

Without a request, the start page's **Pubky Ring** card (its code on a computer, **Sign in with
Pubky Ring** on a phone) adds an identity that already
exists in Ring, with no invite. It asks Ring for the same profile grant as profile editing and saves whichever
pubky approves, without setup and without writing anything: an existing profile stays as it is
until the user edits it.

The pending **Signing in to…** context remains visible during either path. Both share a progress
indicator with three steps: **Verify** (SMS, Lightning or an invite code), **Account** (where the key
lives, its recovery file and the signup, so it is ticked only once the account exists) and
**Profile**. While Passport registers the key, the checklist says **Keep this window open**. New accounts stay in setup until their
`/pub/pubky.app/profile.json` is successfully published. Completion then returns to the original
permission review for explicit approval. When the waiting app requires a profile, **Skip for now**
is not offered, neither on **Account created.** nor on the profile form. Without a pending request, completion opens the selected
identity overview. Google completion still requires the user to
choose **Continue**; local registration and profile publication must finish before returning.

**Download recovery file** in identity management uses the same password and file-check screens,
with the same single password field. Verification decrypts the selected file and compares its
public key with the selected identity, without signing in or importing another identity. Back
returns to the password screen; successful verification or skipping the check returns to
management. A backup requested by the removal confirmation cannot skip its check, because the key
is deleted next.

Each browser-held identity records, without any file contents, when Passport last made a recovery
file of its key, when it last saw one open with its password, and when Pubky Ring last signed in
with the key (the Pubky Ring check, below); importing a recovery file counts as a checked
backup. The status is stored under its own `local-identities/v1/identity-backup/<pubky>` key,
beside the identity record, so a rolled-back build (which rejects records with unknown fields)
still lists the identity. **Manage identity**, the overview and the removal confirmation show that
status; the overview and the removal confirmation offer **Check recovery file** for a file that was
never checked, which opens **Verify your backup.** (below). Only Pubky Ring, a Google Drive copy, a checked file or a copy Pubky Ring signed
with counts as protecting the key: Passport cannot see what the browser did with a file it made, so
a download that was cancelled, or a backup screen left with Back, changes nothing.

Manage's **Backup & key access** card, for a key saved in the browser, has a **Back up** section
(**Migrate to Pubky Ring** and **Download recovery file**, two plain buttons in one row), a
**Verify** section with one row, **Verify backup**, beside the most recent check ("Last verified
<date> (Recovery file|Pubky Ring)" or "Never verified"), the Google account section, and **Remove
from this browser** set apart below a divider at the end. **Verify backup** opens **Verify your
backup.**, one page with both checks and no step before them: on a computer two cards side by
side, below 768px stacked with the recovery file first. Both are the start page's choice cards:
from 1024px a large illustration on the left, and the title, the status and the check on the
right. The **Recovery file** card has a file picker, a password field and its own **Verify
recovery file** button, under "Last checked <date>" (or "Never checked"); the **Pubky Ring** card shows the shared Ring QR code
at once on a computer (on a phone the card's **Verify in Pubky Ring** opens Pubky Ring from one
button that stays, with **Cancel**, and no code), "Last verified <date>" (or "Never verified")
and the store badges. The recovery-file card says its failures at its fields; the Pubky Ring card
says them in a toast, while a computer's code turns into its blurred "Click to reload" tile, which
starts a new check, and a phone offers **Try again**. One failing leaves the other card as it
was. A check that passes is said with a toast ("Recovery file
verified" or "Verified in Pubky Ring") and the page goes back by itself to where it was opened:
Manage, the overview (its backup warning's **Check recovery file**), or the removal confirmation
(its **Check recovery file**), which then shows the checked backup. Its one **Back** leads there
too. The identity card is left out, so the page fits
a 1280x800 window without scrolling. One action leaves an identity, **Remove from this browser**: for a key
saved in the browser it is that card's last action; for a Ring identity it is the overview's **Log
out**, beside **Switch**, with the same confirmation, and Cancel returns to the overview. For a browser key without such protection its confirmation is headed **Remove this key from
this browser?**, warns that it may delete the only copy and offers the backup (and, for an
unchecked file, its check) first; otherwise it is headed **Remove this identity from this
browser?**. Removing an identity protected only by a checked file, or by a copy Pubky Ring signed
with, still asks the user to confirm they have it.

The Pubky Ring check proves that Pubky Ring holds a key saved in the browser, as checking a file
proves the file opens. Passport shows a `pubkyauth` request (the shared Ring QR code, or its link
on a phone) that asks for no capabilities, on the instance's relay. The approval counts only
when Ring signed it with this identity's key: another pubky is refused with "Pubky Ring approved
with a different pubky" and nothing is recorded. The Session the approval yields is used only to
read that key and is signed out at once, never stored; nothing is written to the homeserver. A
match records the date beside the key's other backup dates, which then counts as a confirmed
backup everywhere a checked file does: the overview's warning, the removal confirmation and the
Google detachment, which then asks for **DETACH** rather than **ONLY COPY**. Neither Pubky Ring's
handling of a request without capabilities nor a homeserver's acceptance of such a grant has been
verified on a device or a real homeserver yet; the e2e suite plays both with the SDK.

**Migrate to Pubky Ring** shows the secret-bearing migration QR code on a computer only after
**Show QR code**, next to a warning that the code contains the private key, and withdraws it when
the page is hidden or the layout changes. A phone gets **Open in Pubky Ring** alone and never the
code, not even when Ring did not open. The key stays in the browser afterwards. Unlike every other Ring QR code, pressing
this one copies nothing: its link is the private key. Ring cannot report the import, so the screen
goes on with **Continue** to **Verify your backup.**, where **Skip for now**, or a check passing,
leads on to Manage and **Back** returns to the export; in the Google detachment the same page
follows the export and leads on to the detachment's backup choice.

Every QR code Passport shows for Pubky Ring (an app's request handed to Ring, Passport's profile
grant, the Ring signup and the migration) uses one tile, styled as pubky.app's: a light tile, the
code at error correction H with Pubky Ring's mark over its centre, a "Generating QR code…" state
of the same size while the link is prepared, and a dark, blurred "Click to reload" state when a
profile grant or backup check request can no longer be used (it expired or failed). Pressing that
state starts a new request; why the old one ended is said in an error toast, never in a box under
the code, and there is no separate **Try again** on a computer (a phone, which shows no code,
gets **Try again** in its button's place). A key export that fails to read the key says so in a
toast too. The profile grant and backup check show no waiting line: the code, or a
phone's button, is the whole hand-off. Pressing a ready code copies its link, says "Authentication
link copied" (or "Could not copy to clipboard") and lightens the code for a moment; the link is
never logged.

Every Ring hand-off (an app's request, the profile grant, the backup check, the Ring signup and
the key export) shows its code, or a phone's button, in one Ring card: on a screen of its own a
card with Pubky Ring's scan illustration on its left from 1024px, as the choice cards have it, and
the code with the App Store and Google Play badges centred under it, inside the card (no "Don't
have Pubky Ring?" line; screen readers still hear it). The screen's actions follow the card.
Inside a card that already names Pubky Ring and shows the illustration (the start page's, and the
one on Verify your backup) the code, the badges and **Cancel** start on the card text's edge,
under its title and description. A request that can no longer be used shows, in the same place,
the blurred tile on a computer and **Try again** on a phone.

**Back** looks the same on every screen: an outlined 120px button on the left (full width only on
a phone narrower than 30rem, where the actions stack), with the screen's primary action on the
same row on the right.

## Client contract

There is no separate signup callback protocol. Clients must keep waiting on the SDK flow they
created before opening Passport. Only the SDK `Session` authenticates the user. Passport's existing
authorization outcome message remains a UI/transport signal and never substitutes for the SDK
result.

For a Ring identity already saved in Passport, the overview's **Edit profile** connects Ring
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
with **Back**) after Ring approved but before the connection completed. This is by design: the
grant lasts for the page session, and leaving the page does not revoke it on the homeserver. On page
hide Passport starts the revocation as a best effort, but the SDK's `DELETE` is sent without
`keepalive`, so the browser drops it when the page unloads, and closing the tab sends nothing at
all. The grant then stays valid on
the homeserver for its lifetime (two years), although no one holds its session any more, and
neither Passport nor Ring can list or revoke it. Disposing a connection also deletes the SDK's
delegated keys from the browser (`browserSessionStore.clearAll()`), including those of abandoned
requests, so they do not accumulate in IndexedDB. A Web Lock held by every open profile grant keeps
one Passport tab from deleting a key that another still signs with. Whether Ring and the homeserver
accept write-only scopes has not been verified on a device; test it before release.

With an app request, **Continue with Pubky Ring**, on the identity list or the start page, opens a
separate sign-in screen with the original validated `pubkyauth` URL unchanged.
A Ring identity saved in Passport is there for its profile only: Passport cannot make Ring sign
with it, so it is never listed for a request. Its overview shows its profile, its pubky, **Edit
profile**, **Log out** (in the place a browser key's **Manage** has; it opens the same "Remove
this identity from this browser?" confirmation) and **Switch**, nothing about signing, backups or the key; it has no Manage screen, and no navigation
leads to one. With only Ring
identities saved, a request opens on the start page, as with nothing saved. Passport's own profile
request never stands in front of an app's request; it runs from the overview, or when
the app asks for a profile after a Pubky Ring sign-in (see
[Requiring a profile](signer-behavior.md#requiring-a-profile)). Compatible Pubky signers can use the same QR. Mobile users
can open Ring directly or optionally show the QR. Back returns to the originating screen. Opening
Ring does not send an authorization outcome. On the same device Ring opens the request's
`x-success` URL itself after approval, so the person returns to the app without Passport. Wherever
Ring runs, while the screen is shown and the page is in view,
Passport reads the relay's acknowledgement for the app's channel (`GET <channel>/ack`, see
[Outcome messages](integration.md#outcome-messages)) and ends the review by itself once Ring's answer is
there for the app: acknowledged by the app's SDK while the app's popup opener can receive
Passport's message, posted and waiting when Passport can only navigate back to the app. Nobody
reports the approval by hand: where Passport cannot watch the relay, the screen stays until the
app closes it. The review then ends with the request's `success` callback, a hint like every
outcome: the popup closes after an acknowledged message, or the page follows the validated
`x-success` URL. With no callback or app page to return to, Passport goes on to its own home and
never reports the request as approved. Passport keeps that URL out
of persistent storage, logs, and general UI state; reloading setup does not restore a scrubbed
request URL. If it expires while setup is in progress, a locally completed identity remains saved,
but the client must start a fresh SDK authorization flow.

## Verification availability

Passport checks the configured Homegate from the browser, so proxy regional rules see
the user's location. These checks never send SMS, create invoices, or request invites:

- SMS: `GET /sms_verification/info`, expecting 200 with an empty body.
- Lightning: `GET /ln_verification/info`, expecting 200 with a positive integer `amountSat`.
- Google: `GET /google_verification`, expecting 405 from the POST-only route. There is no
  Google `/info` endpoint. Google also requires a configured Passport client ID and enabled
  provider setting. Disabled methods are not probed.

A 404 hides the method. A 403 displays the disabled regional-restriction card from the
[Figma design](https://www.figma.com/design/01ZvjSPZnKTNmaEWz0yJsq/Pubky-SHADCN?node-id=41492-356648);
below the `lg` breakpoint, where the cards collapse to their buttons, a row under the method names
it (for example "Phone verification: not available in your country"). Screen readers hear one
polite summary that names the blocked methods and what is left.
Google is the exception: its probe governs only creating new Google identities, because restoring
an existing identity from Drive never calls Homegate. The Google sign-in stays available whenever
the provider enables Google and a client ID is configured. A 403 adds a note inside the Google
option that new Google sign-ups are not available in the user's country, with its own **Check
again**, and renames the sign-in **Restore with Google**; an unknown result says the check failed
and that restoring still works; a 404 adds nothing. If Drive holds no identity and Homegate then
refuses the signup token, the Google error screen says why, and offers no retry for a regional
block (a 403 from the signup route, which Homegate itself never sends) or a sign-up limit.
Restoring an identity whose homeserver signup never finished asks Homegate for a token too; if
that is refused, the screen says the identity is safe in Drive and can be finished later.
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
identity and its key locally. When a recovery file of the key was checked (during the
detachment, or checked or imported earlier, which is named with its date) it goes on directly;
otherwise the user must type ONLY COPY, acknowledging that this browser will keep the key's only
copy, before anything in Drive is deleted. It names the Google account to choose in Google's
window. Local-key identities without a Google association can use
**Manage identity → Google account → Attach to Google**. This enables Google sign-in by
backing up the existing key. Attachment checks Drive metadata only and stops if any Passport
backup already exists; it never downloads, decrypts, or overwrites that backup. Ring-held keys remain in Ring.

## Validation

Automated SMS and Lightning coverage uses mocked Homegate responses; it must not send live texts or
payments. Ring signup, subsequent authorization, and the write-only profile grant (Ring's consent
and the homeserver's acceptance of `:w` scopes) require a separate device test.
Run `pnpm check` and `pnpm test:e2e:run` before shipping.
