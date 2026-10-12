import {
  AuthFlowKind,
  Client,
  Pubky,
  SigninGrantDeepLink,
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
        const approvedUrl = request.validatedUrlForApproval(declined);
        if (!approvedUrl) throw new Error("Reviewed request was unavailable");

        const parsed = SigninGrantDeepLink.parse(approvedUrl);
        try {
          expect(parsed.approvalFormat).toBe("signedApprovalV1");
          expect(parsed.capabilities).toBe(approved);
          expect(parsed.secret).toBeUndefined();
          expect(parsed.ephemeralPublicKey).toHaveLength(32);
          expect(new URL(approvedUrl).searchParams.get("epk")).toBe(
            original.searchParams.get("epk"),
          );
        } finally {
          parsed.free();
        }

        const identity = expectOk(signer.createIdentityKey());
        expectOk(await signer.approveAuthRequest(identity.keyHandle, approvedUrl));
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
      const approvedUrl = request.validatedUrlForApproval(["/priv/chat/"]);
      if (!approvedUrl) throw new Error("Reviewed request was unavailable");
      const downgradedUrl = new URL(approvedUrl);
      downgradedUrl.searchParams.delete("af");
      const identity = expectOk(signer.createIdentityKey());

      expectOk(await signer.approveAuthRequest(identity.keyHandle, downgradedUrl.toString()));
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
      expectOk(await signer.approveAuthRequest(identity.keyHandle, flow.authorizationUrl));

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
