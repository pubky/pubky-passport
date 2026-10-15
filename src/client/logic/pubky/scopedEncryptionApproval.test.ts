import {
  AuthFlowKind,
  Client,
  Pubky,
  SigninGrantDeepLink,
  type AuthFlow,
  type GrantAuthFlow,
  type Capabilities,
} from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { PubkySdkAdapter } from "./PubkySdkAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real SDK scoped-encryption approvals", () => {
  it.each([
    {
      name: "approved encryption independently of another scope's storage access",
      requested: "/priv/chat/:rwe,/pub/profile/:rw",
      declined: [],
      approved: "/priv/chat/:rwe,/pub/profile/:rw",
    },
    {
      name: "storage access after declining every encryption permission",
      requested: "/priv/chat/:rwe,/pub/profile/:re",
      declined: ["/priv/chat/", "/pub/profile/"],
      approved: "/priv/chat/:rw,/pub/profile/:r",
    },
    {
      name: "an empty capability list after declining a keys-only request",
      requested: "/pub/chat/:e",
      declined: ["/pub/chat/"],
      approved: "",
    },
    {
      name: "keys for one scope after declining another scope's keys",
      requested: "/priv/chat/:rwe,/priv/backup/:re",
      declined: ["/priv/chat/"],
      approved: "/priv/chat/:rw,/priv/backup/:re",
    },
    {
      name: "distinct decomposed and composed Unicode encryption scopes",
      requested: "/priv/cafe\u0301/:rwe,/priv/café/:e",
      declined: ["/priv/cafe\u0301/"],
      approved: "/priv/cafe\u0301/:rw,/priv/café/:e",
    },
  ] as const)(
    "delivers a verifiable HPKE signed approval with $name",
    async ({ requested, declined, approved }) => {
      const relay = interceptProtocolRequests();
      const app = relyingParty();
      const signer = new PubkySdkAdapter();
      let flow: GrantAuthFlow | undefined;

      try {
        flow = await signedFlow(app, requested);
        const original = new URL(flow.authorizationUrl);
        const request = expectOk(
          ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(flow.authorizationUrl)),
        );
        const originalUrl = request.validatedUrlForApproval();
        const approvedCapabilities = request.approvedCapabilitiesForApproval(declined);
        if (!originalUrl || approvedCapabilities === undefined) {
          throw new Error("Reviewed request was unavailable");
        }
        expect(originalUrl).toBe(flow.authorizationUrl);
        expect(approvedCapabilities).toBe(approved);

        const parsed = SigninGrantDeepLink.parse(originalUrl);
        try {
          expect(parsed.approvalFormat).toBe("signedApprovalV1");
          expect(parsed.capabilities).toBe(requested);
          expect(parsed.secret).toBeUndefined();
          expect(parsed.ephemeralPublicKey).toHaveLength(32);
          expect(new URL(originalUrl).searchParams.get("epk")).toBe(
            original.searchParams.get("epk"),
          );
        } finally {
          parsed.free();
        }

        const identity = expectOk(signer.createIdentityKey());
        expectOk(
          await signer.approveAuthRequest(identity.keyHandle, originalUrl, approvedCapabilities),
        );
        expect(relay.deliveries).toHaveLength(1);
        expect(new TextDecoder().decode(relay.deliveries[0]!.slice(0, 14))).toBe("pubky-hpke-v1\0");
        expect(relay.channelUrl).not.toContain(original.searchParams.get("epk")!);

        // Real SDK receiving code opens HPKE, verifies the envelope and key scopes, and checks
        // narrowed scopes before looking up the authenticated user's homeserver.
        // PKARR deliberately returns no record: no real homeserver is contacted.
        await expect(flow.awaitApproval()).rejects.toMatchObject({
          name: "RequestError",
          message: expect.stringContaining("could not resolve homeserver"),
        });
        expect(relay.resolutions.map((url) => new URL(url).pathname)).toEqual([
          `/${identity.publicIdentity.publicKeyZ32}`,
        ]);
      } finally {
        flow?.free();
        signer.dispose();
        app.free();
        relay.close();
      }
    },
  );

  it.each([
    ["a broader directory", "/priv/chat/:re", "/priv/:e"],
    ["an unrelated directory", "/priv/chat/:re", "/priv/photos/:e"],
    ["an unrequested storage action", "/priv/chat/:re", "/priv/chat/:rw"],
    ["an unrequested encryption action", "/priv/chat/:rw", "/priv/chat/:e"],
    ["a directory that resembles a requested file", "/priv/chat:re", "/priv/chat/:e"],
    ["different Unicode bytes", "/priv/cafe\u0301/:re", "/priv/café/:e"],
    ["malformed actions", "/priv/chat/:re", "/priv/chat/:rx"],
  ] as const)("rejects %s before posting any approval", async (_label, requested, approved) => {
    const relay = interceptProtocolRequests();
    const app = relyingParty();
    const signer = new PubkySdkAdapter();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let flow: GrantAuthFlow | undefined;

    try {
      flow = await signedFlow(app, requested);
      const identity = expectOk(signer.createIdentityKey());
      const result = await signer.approveAuthRequest(
        identity.keyHandle,
        flow.authorizationUrl,
        approved,
      );
      expect(Result.isError(result) && result.error.code).toBe("approval_failed");
      expect(relay.deliveries).toEqual([]);
      expect(relay.resolutions).toEqual([]);
    } finally {
      warning.mockRestore();
      flow?.free();
      signer.dispose();
      app.free();
      relay.close();
    }
  });

  it.each(["/pub/shop/:rw", "/pub/shop/:r", ""] as const)(
    "keeps legacy cookie approvals compatible with approved capabilities %j",
    async (approved) => {
      const relay = interceptProtocolRequests();
      const app = relyingParty();
      const signer = new PubkySdkAdapter();
      let flow: AuthFlow | undefined;

      try {
        flow = app.startCookieAuthFlow(
          "/pub/shop/:rw",
          AuthFlowKind.signin(),
          "https://relay.example/inbox",
        );
        const identity = expectOk(signer.createIdentityKey());
        expectOk(
          await signer.approveAuthRequest(identity.keyHandle, flow.authorizationUrl, approved),
        );
        const token = await flow.awaitToken();
        try {
          expect(token.capabilities).toEqual(approved ? [approved] : []);
          const publicKey = token.publicKey;
          try {
            expect(publicKey.z32()).toBe(identity.publicIdentity.publicKeyZ32);
          } finally {
            publicKey.free();
          }
        } finally {
          token.free();
        }
        expect(relay.deliveries).toHaveLength(1);
        expect(relay.resolutions).toEqual([]);
      } finally {
        flow?.free();
        signer.dispose();
        app.free();
        relay.close();
      }
    },
  );

  it.each(["/pub/shop/:rw", "/pub/shop/:r", ""] as const)(
    "keeps bare-grant approvals compatible with approved capabilities %j",
    async (approved) => {
      const relay = interceptProtocolRequests();
      const app = relyingParty();
      const signer = new PubkySdkAdapter();
      let flow: GrantAuthFlow | undefined;

      try {
        flow = await app.startGrantAuthFlow("/pub/shop/:rw", AuthFlowKind.signin(), {
          clientId: "shop.pubky.app",
          relay: "https://relay.example/inbox",
        });
        const identity = expectOk(signer.createIdentityKey());
        expectOk(
          await signer.approveAuthRequest(identity.keyHandle, flow.authorizationUrl, approved),
        );
        expect(relay.deliveries).toHaveLength(1);
        expect(new TextDecoder().decode(relay.deliveries[0]!.slice(0, 14))).not.toBe(
          "pubky-hpke-v1\0",
        );
        await expect(flow.awaitApproval()).rejects.toMatchObject({
          name: "RequestError",
          message: expect.stringContaining("could not resolve homeserver"),
        });
        expect(relay.resolutions.map((url) => new URL(url).pathname)).toEqual([
          `/${identity.publicIdentity.publicKeyZ32}`,
        ]);
      } finally {
        flow?.free();
        signer.dispose();
        app.free();
        relay.close();
      }
    },
  );

  it("rejects a bare-grant downgrade even after declining every encryption permission", async () => {
    const relay = interceptProtocolRequests();
    const app = relyingParty();
    const signer = new PubkySdkAdapter();
    let flow: GrantAuthFlow | undefined;

    try {
      flow = await signedFlow(app, "/priv/chat/:rwe");
      const request = expectOk(
        ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(flow.authorizationUrl)),
      );
      const approvedCapabilities = request.approvedCapabilitiesForApproval(["/priv/chat/"]);
      if (approvedCapabilities === undefined) throw new Error("Reviewed request was unavailable");
      // Simulate an obsolete signer attempting to send a bare grant to an af=v1 requester.
      const downgradedUrl = new URL(flow.authorizationUrl);
      downgradedUrl.searchParams.set("caps", approvedCapabilities);
      downgradedUrl.searchParams.delete("af");
      const identity = expectOk(signer.createIdentityKey());

      expectOk(
        await signer.approveAuthRequest(
          identity.keyHandle,
          downgradedUrl.toString(),
          approvedCapabilities,
        ),
      );
      await expect(flow.awaitApproval()).rejects.toMatchObject({ name: "AuthenticationError" });
      expect(relay.resolutions).toEqual([]);
    } finally {
      flow?.free();
      signer.dispose();
      app.free();
      relay.close();
    }
  });

  it("rejects altered encrypted approvals before homeserver resolution", async () => {
    const relay = interceptProtocolRequests(true);
    const app = relyingParty();
    const signer = new PubkySdkAdapter();
    let flow: GrantAuthFlow | undefined;

    try {
      flow = await signedFlow(app, "/priv/chat/:rwe");
      const identity = expectOk(signer.createIdentityKey());
      expectOk(
        await signer.approveAuthRequest(
          identity.keyHandle,
          flow.authorizationUrl,
          "/priv/chat/:rwe",
        ),
      );

      await expect(flow.awaitApproval()).rejects.toMatchObject({ name: "AuthenticationError" });
      expect(relay.resolutions).toEqual([]);
    } finally {
      flow?.free();
      signer.dispose();
      app.free();
      relay.close();
    }
  });

  it.each([
    ["af=v2", "unsupported_approval_format"],
    ["af=", "unsupported_approval_format"],
    ["", "encryption_requires_signed_approval"],
  ] as const)("matches SDK fail-closed behavior for approval format %s", async (format, code) => {
    const relay = interceptProtocolRequests();
    const app = relyingParty();
    let flow: GrantAuthFlow | undefined;

    try {
      flow = await signedFlow(app, "/priv/chat/:rwe");
      const url = new URL(flow.authorizationUrl);
      url.searchParams.delete("af");
      if (format) {
        const [name, value] = format.split("=");
        url.searchParams.set(name!, value!);
      }
      expect(() => SigninGrantDeepLink.parse(url.toString())).toThrow();
      const parsed = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(url.toString()));
      expect(Result.isError(parsed) && parsed.error).toEqual({ code });
      expect(relay.deliveries).toEqual([]);
    } finally {
      flow?.free();
      app.free();
      relay.close();
    }
  });
});

function relyingParty(): Pubky {
  return Pubky.withClient(
    new Client({ pkarr: { relays: ["https://pkarr.example"], requestTimeout: 100 } }),
  );
}

function signedFlow(app: Pubky, capabilities: Capabilities): Promise<GrantAuthFlow> {
  return app.startGrantAuthFlow(capabilities, AuthFlowKind.signin(), {
    clientId: "passport.test",
    relay: "https://relay.example/inbox",
    approvalFormat: "signedApprovalV1",
  });
}

function expectOk<Value>(result: ResultType<Value, unknown>): Value {
  if (Result.isError(result)) throw result.error;
  return result.value;
}

function interceptProtocolRequests(alterCiphertext = false) {
  const deliveries: Uint8Array<ArrayBuffer>[] = [];
  const resolutions: string[] = [];
  let channelUrl: string | undefined;
  let deliver: ((response: Response) => void) | undefined;
  let received: Uint8Array<ArrayBuffer> | undefined;

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === "relay.example") {
        if (request.method === "POST") {
          const bytes = new Uint8Array(await request.arrayBuffer());
          deliveries.push(bytes);
          channelUrl = request.url;
          received = bytes.slice();
          if (alterCiphertext) received[received.length - 1] = received[received.length - 1]! ^ 1;
          deliver?.(mockResponse(request.url, received));
          return mockResponse(request.url, null, 200);
        }
        if (request.method === "GET") {
          if (received) return mockResponse(request.url, received);
          return new Promise<Response>((resolve) => {
            deliver = resolve;
            request.signal.addEventListener(
              "abort",
              () => resolve(mockResponse(request.url, null, 410)),
              { once: true },
            );
          });
        }
        if (request.method === "DELETE") return mockResponse(request.url, null, 204);
      }
      if (url.hostname === "pkarr.example") {
        resolutions.push(request.url);
        return mockResponse(request.url, null, 404);
      }
      throw new Error(`Unexpected test network request: ${request.method} ${url.origin}`);
    }),
  );

  return {
    deliveries,
    resolutions,
    get channelUrl() {
      return channelUrl;
    },
    close() {
      deliver?.(mockResponse(channelUrl ?? "https://relay.example/inbox", null, 410));
    },
  };
}

// A synthetic Response has no URL, while reqwest's WASM bridge requires the
// same final URL that an actual browser fetch response provides.
function mockResponse(url: string, body: BodyInit | null = null, status = 200): Response {
  return Object.defineProperty(new Response(body, { status }), "url", { value: url });
}
