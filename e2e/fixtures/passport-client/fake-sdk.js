// A routed stand-in for @synonymdev/pubky: the package's only SDK boundary (pubkyFlowAdapter) sees
// SDK-shaped handles, and the test decides when a poll returns a Session. Never a real approval.
const sdk = (globalThis.__fakeSdk ??= {
  authorizationUrl: undefined,
  publicKey: undefined,
  capabilities: [],
  profileReads: [],
  starts: [],
  polls: 0,
  flowFrees: 0,
  signouts: 0,
  sessionFrees: 0,
  pending: [],
  approve() {
    for (const resolve of this.pending.splice(0)) resolve(fakeSession());
  },
});

function fakeSession() {
  return {
    get info() {
      return {
        get publicKey() {
          return { z32: () => sdk.publicKey, free() {} };
        },
        capabilities: [...sdk.capabilities],
        free() {},
      };
    },
    async signout() {
      sdk.signouts++;
    },
    free() {
      sdk.sessionFrees++;
    },
  };
}

export function validateCapabilities(input) {
  return input;
}

export class AuthFlowKind {
  static signin() {
    return new AuthFlowKind();
  }
  free() {}
}

/** A client for custom PKARR relays (`pkarrRelays`); the fake records what it was given. */
export class Client {
  constructor(config) {
    (sdk.clients ??= []).push(config);
  }
}

export class Pubky {
  static withClient(client) {
    const pubky = new Pubky();
    pubky.client = client;
    return pubky;
  }

  async startGrantAuthFlow(capabilities, kind, options) {
    const index = sdk.starts.length;
    sdk.starts.push({
      capabilities,
      clientId: options?.clientId,
      xSource: options?.xCallback?.xSource,
      callbacks: Boolean(options?.xCallback?.xSuccess),
    });
    return {
      // Numbered on request, so a test can tell one flow's link from the next.
      get authorizationUrl() {
        return sdk.numberLinks ? `${sdk.authorizationUrl}&flow=${index}` : sdk.authorizationUrl;
      },
      tryPollOnce() {
        sdk.polls++;
        return new Promise((resolve) => sdk.pending.push(resolve));
      },
      saveDelegated() {
        throw new Error("Popup flows never save state");
      },
      free() {
        sdk.flowFrees++;
      },
    };
  }
  async resumeDelegatedGrantAuthFlow() {
    throw new Error("No same-tab return in this fixture");
  }
  get publicStorage() {
    return {
      async get(address) {
        sdk.profileReads.push(address);
        // The identity's homeserver, as the test routes it (Passport publishes there too).
        return fetch(`https://homeserver.example/${address.replace(/^pubky[^/]+\//u, "")}`);
      },
      free() {},
    };
  }
}
