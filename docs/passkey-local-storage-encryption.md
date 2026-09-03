# Passkey-protected local secret storage

> Research proof of concept, 2026-09-03. This branch is intentionally not merge-ready.

## Recommendation

Use the WebAuthn Level 3 `prf` extension to unlock a random local data-encryption key (DEK),
then encrypt each Pubky secret key with AES-256-GCM. Keep identity metadata readable while the
vault is locked. This is the strongest browser-native, local-first design currently available
because the credential's PRF output is stable key material that is released only through a
user-verifying WebAuthn ceremony.

Do not derive encryption keys from ordinary WebAuthn signatures. A passkey's private key is not
exposed to the page, and assertions sign ceremony-specific data rather than provide stable key
material. The PRF extension exists specifically for uses such as deriving a symmetric encryption
key. The extension returns 32-byte outputs, uses the user-verified PRF when backed by CTAP
`hmac-secret`, and is scoped to the credential for its lifetime.

“Biometric unlock” needs precise product language. A site can require **user verification**, but
the authenticator chooses whether that is a fingerprint, face scan, device PIN, password, or
another local method. Passport cannot require biometrics specifically or learn biometric data.

The proposal should remain behind an experiment flag until we test the exact browser, OS, and
credential-provider combinations Passport supports. WebAuthn extensions are optional, PRF output
may be unavailable during credential creation, and support must be confirmed on the newly created
credential rather than inferred from a browser version.

## Proposed envelope

The proof of concept in
[`PasskeyLocalStorageVault`](../src/client/logic/local-identity/passkey-vault/PasskeyLocalStorageVault.ts)
uses envelope encryption:

1. Ask for a discoverable platform credential with `userVerification: "required"` and a random
   32-byte PRF input.
2. Require registration to report `prf.enabled === true`. If registration does not return a PRF
   result, perform an immediate assertion. Some authenticators therefore require two prompts at
   setup.
3. Generate a random 256-bit DEK.
4. Expand the 32-byte PRF output with HKDF-SHA-256, domain-separated by the Passport origin and
   credential ID, into a non-extractable AES-256-GCM key-encryption key (KEK).
5. Encrypt the DEK with the KEK, a fresh 96-bit IV, a 128-bit tag, and authenticated metadata.
   Persist only the credential ID, public PRF input, IV, and wrapped DEK.
6. Import the DEK as a non-extractable in-memory `CryptoKey`. Encrypt every 32-byte Pubky secret
   under it with a fresh IV. Authenticate the envelope version, exact Passport origin, and Pubky
   public key as additional data.
7. On lock, drop the in-memory DEK handle. On unlock, repeat the user-verifying PRF assertion and
   unwrap it.

Conceptually, local storage becomes:

```text
configuration = {
  v, algorithm, origin,
  credentialId, prfSalt,
  wrappedDataKey: { iv, ciphertext+tag }
}

identity/<public-key> = {
  v, algorithm, publicKey,
  iv, encrypted-secret-key+tag
}
```

The PRF output and plaintext DEK are never serialized. The current PoC also avoids calling
`PublicKeyCredential.toJSON()`: the WebAuthn specification warns that serialized credential
responses can include PRF outputs.

The extra DEK layer is useful even though the PRF output could encrypt records directly. It lets
us rotate or add unlock credentials by rewrapping one small key, supports future recovery slots,
and keeps the passkey-facing protocol separate from the identity record format.

## What this protects

| Threat                                                                                       | Result                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copied `localStorage`, browser-profile files, backups, or diagnostics without the credential | Secret keys remain encrypted.                                                                                                                        |
| Accidental inspection in browser developer tools while locked                                | Only metadata and ciphertext are visible.                                                                                                            |
| Tampering, swapping identities, or moving records between Passport origins                   | AES-GCM authentication fails because version, origin, and public key are authenticated.                                                              |
| A different web origin                                                                       | WebAuthn RP scoping and browser storage origin isolation apply in addition to encryption.                                                            |
| XSS or compromised same-origin dependency while locked                                       | It cannot silently read plaintext, but it can request an unlock prompt. If the user approves a deceptive prompt, it can use the returned PRF output. |
| XSS after unlock                                                                             | Not protected. Same-origin code can call the vault and use the in-memory key.                                                                        |
| Malicious browser extension, browser, OS, or a person able to pass the device unlock         | Not protected.                                                                                                                                       |
| Lost passkey or cleared site data                                                            | Data can become permanently unrecoverable unless Passport retains a separate recovery path.                                                          |

The critical limit is same-origin code execution. WebAuthn's own security considerations say code
injection on an RP origin can invalidate its guarantees and recommend minimizing third-party
script and enforcing CSP. This feature raises the cost of passive storage theft; it is not an XSS
sandbox. Passport should pair it with its existing strict CSP and continue reducing script and
dependency exposure.

JavaScript also cannot promise reliable zeroization. The PoC clears caller-owned temporary byte
arrays where practical and keeps operational keys non-extractable, but browser and cryptographic
implementations can retain copies. `lock()` means “release our `CryptoKey` reference,” not
“cryptographically prove all memory was erased.”

## Alternatives considered

| Method                                                        | Assessment                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebAuthn PRF + local envelope encryption                      | **Recommended local-first option.** User verification gates stable credential-bound key material. Optional extension support and recovery are the main constraints.                                                                      |
| Server verifies a passkey and releases/derives a wrapping key | Best compatibility fallback if Passport accepts an online service and server trust. It supports account-level recovery and multiple passkeys, but the service becomes availability-sensitive and may be able to derive the wrapping key. |
| WebAuthn `largeBlob`                                          | Useful as an optional place to carry a wrapped DEK, not as the primary vault. It is optional, authenticator storage is intentionally small, and portability/provider behavior adds another compatibility dimension.                      |
| Non-extractable WebCrypto key in IndexedDB                    | Useful defense in depth, but it does not invoke user verification. Any same-origin script that obtains the handle can ask it to decrypt, even when the raw key is non-extractable.                                                       |
| Password/PIN-derived encryption                               | Broadly compatible and recoverable but vulnerable to offline guessing unless the secret has high entropy. A device PIN cannot be reused by the page as key material.                                                                     |
| Key derived from a normal assertion signature                 | Reject. Assertion inputs and outputs are ceremony-specific, and WebAuthn exposes signing rather than a stable key-agreement/KDF primitive.                                                                                               |

`largeBlob` could later store another copy of the already-wrapped DEK for roaming authenticators.
It should not replace a versioned local envelope or the existing Passport recovery file.

## Browser and passkey-provider behavior

- WebAuthn requires a secure context and is mediated by the browser/authenticator.
- Request `authenticatorAttachment: "platform"`, a discoverable credential, and required user
  verification for the intended phone/laptop unlock experience. This still permits a device PIN.
- Verify `getClientExtensionResults().prf.enabled` on registration, then verify an actual 32-byte
  PRF result. Feature detection on the browser alone is insufficient.
- Support evaluation during creation when available, but implement the assertion fallback used by
  this PoC.
- Synced passkeys can carry PRF material when the provider supports doing so, and the FIDO
  credential-exchange format now specifies how providers preserve those values. Actual sync,
  export, and hardware-key behavior still varies. Treat cross-device unlock as a tested capability,
  not a promise.
- A local-only PRF ceremony does not authenticate a Passport server because no server verifies the
  assertion. That is acceptable for deriving a local decryption key: an incorrect or fabricated
  PRF result cannot authenticate the AES-GCM envelope. It is not acceptable if the same ceremony is
  later reused to authorize a server action.

Hard-coded compatibility tables become stale quickly. Before productizing, run a small matrix over
current Safari/WebKit, Chrome/Chromium, and Firefox releases on macOS, iOS, Android, Windows, and
Linux, including their default passkey providers. The WebKit PRF work landed in late 2025 and
Mozilla's platform coverage continued changing in 2026, which reinforces runtime detection.

## Integrating with Passport

The prototype deliberately does not replace the current repository. A production integration
would need these coordinated changes:

1. Split the current local identity record into plaintext display metadata and a versioned secret
   envelope. `list()` can remain synchronous and usable while locked.
2. Make secret `save()` and `read()` paths asynchronous. This reaches
   `GoogleIdentityLifecycle`, `LocalIdentityController`, recovery-file creation, Ring migration,
   and authorization approval.
3. Extract the hardened AES-GCM/HKDF and envelope-validation pieces already used by
   `PassportFileWebCrypto` instead of maintaining the PoC's intentionally separate copy. Keep the
   local-vault and Google Drive envelope formats domain-separated and independently versioned.
4. Add explicit `unconfigured`, `locked`, `unlocking`, and `unlocked` UI states. Start WebAuthn
   from a clear user action, especially in popup authorization flows.
5. Choose a lock policy. A practical initial policy is an in-memory DEK per tab, cleared on explicit
   lock, sign-out, and a short idle/background timeout. Requiring a biometric/PIN prompt for every
   signature is stronger but likely unusable.
6. Coordinate state across tabs without sending the DEK or PRF output. A `BroadcastChannel` can
   announce “lock now”; each tab still performs its own unlock ceremony.
7. Support multiple wrapping slots before calling the feature durable: a primary passkey, another
   passkey or provider, and the existing password-protected recovery file. Removing one credential
   should rewrap the DEK before deleting its slot.
8. Add a server-verified WebAuthn registration/authentication flow if the credential will also
   identify a Passport account or authorize remote actions. Do not treat this local PoC as proof of
   server authentication.

### Safe migration

Migration must be transactional from the user's perspective:

1. Require and verify a usable recovery method.
2. Enroll the PRF credential and successfully unwrap the DEK once.
3. Encrypt legacy secrets into a staging namespace using unique IVs.
4. Decrypt every staged value and verify that each secret derives the expected Pubky public key.
5. Atomically switch a small version/namespace pointer where possible.
6. Delete plaintext records only after all checks succeed. Preserve them on any cancellation,
   storage exception, reload, or partial failure.

The app must also define how an orphaned credential is presented when registration succeeds but a
later storage write fails. Web pages cannot reliably delete a passkey directly from every provider.

## Decisions needed before production work

1. Is unlock local-only, or should the passkey also authenticate a server-side Passport account?
2. Must encrypted identities roam across devices, or is the existing recovery file the explicit
   transfer/recovery path?
3. Which unsupported-PRF fallback is acceptable: server-assisted release, a high-entropy recovery
   secret, or keeping the current plaintext behavior with a warning?
4. How long may the DEK remain unlocked, and what events force a lock?
5. Do we require two independent recovery/unlock slots before deleting legacy plaintext?

## Primary references

- [WebAuthn Level 3: PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension)
- [WebAuthn Level 3: code-injection attacks](https://www.w3.org/TR/webauthn-3/#sctn-code-injection)
- [MDN: WebAuthn PRF and `largeBlob` extension inputs and outputs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)
- [FIDO CTAP: `hmac-secret`](https://fidoalliance.org/specs/fido-v2.0-ps-20190130/fido-client-to-authenticator-protocol-v2.0-ps-20190130.html#sctn-hmac-secret-extension)
- [FIDO Credential Exchange Format: PRF/HMAC material portability](https://fidoalliance.org/specs/cx/cxf-v1.0-rd-20250313.html#fido2-hmac-credentials)
- [Web Cryptography Level 2: key storage and security considerations](https://www.w3.org/TR/WebCryptoAPI/#key-storage)
- [NIST SP 800-38D: AES-GCM and IV uniqueness](https://csrc.nist.gov/pubs/sp/800/38/d/final)
- [WebKit PRF implementation issue](https://bugs.webkit.org/show_bug.cgi?id=259934)
- [Mozilla PRF implementation tracker](https://bugzilla.mozilla.org/show_bug.cgi?id=1863819)
