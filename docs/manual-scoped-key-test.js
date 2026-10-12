import { AuthFlowKind, Pubky } from "@synonymdev/pubky";

const chat = "/priv/chat/v1/";
const notes = "/priv/notes/v1/";
const expected = {
  all: { caps: [`${chat}:rwe`, `${notes}:e`], keys: [chat, notes] },
  notes: { caps: [`${chat}:rw`, `${notes}:e`], keys: [notes] },
  none: { caps: [`${chat}:rw`], keys: [] },
};

/** Call directly from a click handler; return only nonsecret test results. */
export async function testScopedPassport(passportOrigin, mode) {
  if (!Object.hasOwn(expected, mode)) throw new Error("Unknown test case");
  const popup = window.open("about:blank", "passport-scoped-test", "popup,width=390,height=800");
  if (!popup) throw new Error("Popup blocked");
  const app = new Pubky();
  let flow;
  let session;
  try {
    flow = await app.startGrantAuthFlow(`${chat}:rwe,${notes}:e`, AuthFlowKind.signin(), {
      clientId: "passport-scoped-test.example",
      relay: "https://httprelay.staging.pubky.app/inbox",
      approvalFormat: "signedApprovalV1",
      xCallback: { xSource: "Scoped key test" },
    });
    popup.location.replace(
      `${passportOrigin}/authorize#d=${encodeURIComponent(flow.authorizationUrl)}`,
    );
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      session = await flow.tryPollOnce();
      if (session) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!session) throw new Error("Timed out waiting for a real homeserver session");
    return await checkKeys(session, expected[mode]);
  } finally {
    // Free only after the SDK calls above settle. No approval or key is exported.
    flow?.free();
    session?.free();
    app.free();
    popup.close();
  }
}

async function checkKeys(session, want) {
  const info = session.info;
  const grant = session.grant;
  const keys = grant?.encryptionKeys;
  try {
    if (!keys) throw new Error("Expected a signed approval, including when all keys are declined");
    same(info.capabilities, want.caps);
    same(keys.scopes, want.keys);
    const text = new TextEncoder();
    for (const scope of [chat, notes]) {
      const path = `${scope}probe.txt`;
      let key;
      try {
        key = await keys.deriveCryptoKeyForPath(path);
      } catch (error) {
        if (want.keys.includes(scope)) throw error;
        continue;
      }
      if (!want.keys.includes(scope)) throw new Error("Declined scope received a key");
      if (key.extractable) throw new Error("Expected a non-extractable CryptoKey");
      const params = {
        name: "AES-GCM",
        iv: crypto.getRandomValues(new Uint8Array(12)),
        additionalData: text.encode(path),
      };
      const ciphertext = await crypto.subtle.encrypt(params, key, text.encode("scoped-key-test"));
      const plaintext = await crypto.subtle.decrypt(params, key, ciphertext);
      if (new TextDecoder().decode(plaintext) !== "scoped-key-test") {
        throw new Error("Round trip failed");
      }
      const other = await keys.deriveCryptoKeyForPath(`${scope}different.txt`);
      let acceptedWrongPath = false;
      try {
        await crypto.subtle.decrypt(params, other, ciphertext);
        acceptedWrongPath = true;
      } catch {
        // A different file path must produce a different content key.
      }
      if (acceptedWrongPath) throw new Error("Different path decrypted the ciphertext");
    }
    return {
      capabilities: info.capabilities,
      keyScopes: keys.scopes,
      roundTrips: want.keys.length,
    };
  } finally {
    keys?.free();
    grant?.free();
    info.free();
  }
}

function same(actual, wanted) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...wanted].sort())) {
    throw new Error("Approved capabilities or key scopes differ from the selected test case");
  }
}
