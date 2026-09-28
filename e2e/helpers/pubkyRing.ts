import { Keypair, Pubky } from "@synonymdev/pubky";
import type { Page, Route } from "@playwright/test";

import { E2E_HTTP_RELAY_URL } from "./e2eServer";
import { PKARR_RELAY_HOSTS } from "./network";
import { homeserverRecord, PROFILE_KEY } from "./pubkyProfile";

/** The Ring-held identity: `PROFILE_KEY`, whose PKARR record names `homeserver.example`. */
export const RING_KEY = PROFILE_KEY;
const RING_SEED = 1;
const HOMESERVER_DOMAIN = "homeserver.example";
const RELAY_HOST = new URL(E2E_HTTP_RELAY_URL).hostname;

export type RingNetwork = {
  /** Relay messages by `<host><path>`, and the browser's polls still waiting for one. */
  inbox: Map<string, Buffer>;
  waiting: { channel: string; route: Route }[];
  /** Capabilities of each grant exchanged at the homeserver. */
  exchangedGrants: string[][];
  /** Every write (`PUT`) the homeserver received, as `<pubky-host> <path>`. */
  writes: string[];
  /** Every request that reached Passport's relay. */
  relayRequests: string[];
};

/**
 * Answers Passport's relay, the PKARR relays and `homeserver.example` for a Ring identity whose
 * public `profile.json` is `profile` (`null` for none). The grant exchange answers `grantStatus`.
 * Other HTTPS requests fall through to the test's context routes.
 */
export async function mockRingNetwork(
  page: Page,
  { profile = null, grantStatus = 200 }: { profile?: object | null; grantStatus?: number } = {},
): Promise<RingNetwork> {
  const net: RingNetwork = {
    inbox: new Map(),
    waiting: [],
    exchangedGrants: [],
    writes: [],
    relayRequests: [],
  };
  await page.route(/^https:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      if (method !== "GET") return route.fulfill({ status: 204, body: "" });
      const body = homeserverRecord(url.pathname.slice(1), HOMESERVER_DOMAIN);
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    }
    if (url.hostname === RELAY_HOST) {
      const channel = `${url.hostname}${url.pathname}`;
      net.relayRequests.push(`${method} ${url.pathname}`);
      if (method === "DELETE") net.inbox.delete(channel);
      if (method !== "GET") return route.fulfill({ status: 200, body: "" });
      const message = net.inbox.get(channel);
      if (message)
        return route.fulfill({
          status: 200,
          body: message,
          contentType: "application/octet-stream",
        });
      net.waiting.push({ channel, route }); // A long poll, answered once Ring approves.
      return undefined;
    }
    if (url.hostname === HOMESERVER_DOMAIN && !url.pathname.startsWith("/signup_tokens/")) {
      const owner = url.searchParams.get("pubky-host") ?? request.headers()["pubky-host"] ?? "";
      if (url.pathname === "/auth/grant/session" && method === "POST") {
        const { grant } = request.postDataJSON() as { grant: string };
        const claims = JSON.parse(
          Buffer.from(grant.split(".")[1]!, "base64url").toString("utf8"),
        ) as { iss: string; client_id: string; caps: string[]; jti: string; exp: number };
        net.exchangedGrants.push(claims.caps);
        if (grantStatus !== 200) return route.fulfill({ status: grantStatus, body: "refused" });
        const now = Math.floor(Date.now() / 1000);
        return route.fulfill({
          json: {
            token: "e2e-bearer",
            session: {
              homeserver: homeserverKey(),
              pubky: claims.iss,
              client_id: claims.client_id,
              capabilities: claims.caps,
              grant_id: claims.jti,
              token_expires_at: now + 3_600,
              grant_expires_at: claims.exp,
              created_at: now,
            },
          },
        });
      }
      if (method === "PUT") {
        net.writes.push(`${owner} ${url.pathname}`);
        return route.fulfill({ status: 201, body: "" });
      }
      if (method === "DELETE") return route.fulfill({ status: 200, body: "" });
      if (url.pathname.endsWith("/pub/pubky.app/profile.json") && profile && owner === RING_KEY)
        return route.fulfill({ status: 200, json: profile });
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fallback();
  });
  return net;
}

function homeserverKey(): string {
  const keypair = Keypair.fromSecret(new Uint8Array(32).fill(2));
  const publicKey = keypair.publicKey;
  try {
    return publicKey.z32();
  } finally {
    publicKey.free();
    keypair.free();
  }
}

/**
 * Plays Pubky Ring approving `url` with `RING_KEY`: the real SDK signer signs it in the test
 * process, and the encrypted approval lands in the mocked relay inbox it was posted to.
 */
export async function ringApproves(net: RingNetwork, url: string): Promise<void> {
  const realFetch = globalThis.fetch;
  let posted: Buffer | undefined;
  let channel = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === "POST") {
      posted = Buffer.from(await request.clone().arrayBuffer());
      const target = new URL(request.url);
      channel = `${target.hostname}${target.pathname}`;
    }
    const response = new Response("", { status: request.method === "POST" ? 200 : 404 });
    Object.defineProperty(response, "url", { value: request.url });
    return response;
  }) as typeof fetch;
  const pubky = new Pubky();
  const keypair = Keypair.fromSecret(new Uint8Array(32).fill(RING_SEED));
  const signer = pubky.signer(keypair);
  try {
    await signer.approveAuthRequest(url);
  } finally {
    globalThis.fetch = realFetch;
    signer.free();
    keypair.free();
    pubky.free();
  }
  if (!posted) throw new Error("Ring's approval was not posted to a relay");
  net.inbox.set(channel, posted);
  const waiting = net.waiting.filter((poll) => poll.channel === channel);
  net.waiting = net.waiting.filter((poll) => poll.channel !== channel);
  for (const { route } of waiting)
    await route
      .fulfill({ status: 200, body: posted, contentType: "application/octet-stream" })
      .catch(() => undefined);
}

/** Stores a Ring-held identity the way Passport saves one: public key and key source only. */
export async function seedRingIdentity(page: Page, profileSetupRequired = false): Promise<void> {
  await page.goto("/terms-of-service", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, profileSetupRequired }) => {
      localStorage.clear();
      localStorage.setItem(
        `pubky-passport/local-identities/v1/identity/${key}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: key,
          keySource: "ring",
          ...(profileSetupRequired ? { profileSetupRequired: true } : {}),
        }),
      );
      localStorage.setItem("pubky-passport/local-identities/v1/active", key);
    },
    { key: RING_KEY, profileSetupRequired },
  );
}

/**
 * How many delegated PoP keys the SDK holds in this origin's IndexedDB. The database is only
 * read, never created, so the SDK still sets it up on first use.
 */
export async function delegatedKeyCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "pubky-auth")) return 0;
    return new Promise<number>((resolve, reject) => {
      const open = indexedDB.open("pubky-auth");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("delegatedGrantKeys")) {
          db.close();
          resolve(0);
          return;
        }
        const count = db
          .transaction("delegatedGrantKeys", "readonly")
          .objectStore("delegatedGrantKeys")
          .count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => {
          db.close();
          reject(count.error);
        };
      };
    });
  });
}
