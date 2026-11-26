// Stands in for @synonymdev/pubky in the passport-auth e2e fixture. It builds real `pubkyauth://`
// grant requests that Passport reviews and approves; the "Session" appears only after Passport
// posted its approval to the (routed) relay, so a `success` message alone never signs in.

/** A canonical client public key; Passport only checks its format. */
const CLIENT_PUBLIC_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SIGNER_PUBLIC_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";

export const fixture = {
  starts: [],
  results: [],
  polls: 0,
  frees: 0,
  /** Frees while a poll was in flight, or polls after a free. Must stay empty. */
  violations: [],
};
window.__passportAuthFixture = fixture;

export class AuthFlowKind {
  static signin() {
    return new AuthFlowKind();
  }
}

export function validateCapabilities(input) {
  return input;
}

export function createFakePubky(relay) {
  return {
    async startGrantAuthFlow(capabilities, _kind, options) {
      fixture.starts.push(JSON.parse(JSON.stringify(options)));
      // Each flow gets its own relay path, so an approval counts only for the request it answers.
      const flowId = crypto.randomUUID();
      const signed = options.approvalFormat === "signedApprovalV1";
      const query = [
        ["caps", capabilities],
        ["relay", `${relay}/${flowId}`],
        // Signed approvals carry an HPKE recipient key instead of the relay secret.
        signed ? ["af", "v1"] : ["secret", randomSecret()],
        signed ? ["epk", randomSecret()] : [],
        ["cid", options.clientId],
        ["cpk", CLIENT_PUBLIC_KEY],
        ["x-source", options.xCallback?.xSource],
        ["x-success", options.xCallback?.xSuccess],
        ["x-error", options.xCallback?.xError],
        ["x-cancel", options.xCallback?.xCancel],
      ]
        .filter(([, value]) => typeof value === "string")
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("&");
      return new FakeFlow(`pubkyauth://signin_grant?${query}`, flowId);
    },
  };
}

class FakeFlow {
  #inFlight = false;
  #freed = false;

  constructor(authorizationUrl, flowId) {
    this.authorizationUrl = authorizationUrl;
    this.flowId = flowId;
  }

  async tryPollOnce() {
    if (this.#freed) fixture.violations.push("poll after free");
    this.#inFlight = true;
    fixture.polls += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if ((await relayApprovals(this.flowId)) === 0) return undefined;
      return {
        info: { publicKey: { z32: () => SIGNER_PUBLIC_KEY } },
        signout: async () => undefined,
        free: () => undefined,
      };
    } finally {
      this.#inFlight = false;
    }
  }

  free() {
    if (this.#inFlight) fixture.violations.push("free while a poll was in flight");
    if (this.#freed) fixture.violations.push("freed twice");
    this.#freed = true;
    fixture.frees += 1;
  }
}

async function relayApprovals(flowId) {
  const url = `/__fixture/relay-approvals?flow=${encodeURIComponent(flowId)}`;
  const response = await fetch(url, { cache: "no-store" });
  return (await response.json()).approvals;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
