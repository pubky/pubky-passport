import { randomBytes } from "node:crypto";

import { Keypair, Pubky } from "@synonymdev/pubky";
import type { Page, Request, Route } from "@playwright/test";

import { E2E_HTTP_RELAY_URL } from "./e2eServer";
import { PKARR_RELAY_HOSTS } from "./network";
import { homeserverRecord, PROFILE_KEY } from "./pubkyProfile";

/** The Ring-held identity: `PROFILE_KEY`, whose PKARR record names `homeserver.example`. */
export const RING_KEY = PROFILE_KEY;
const RING_SEED = 1;
const HOMESERVER_DOMAIN = "homeserver.example";
const RELAY_HOST = new URL(E2E_HTTP_RELAY_URL).hostname;

/** One `POST /auth/grant/session`: a grant's first exchange after an approval, or a restore. */
export type GrantSessionExchange = {
  /** The grant's ID (its `jti`). */
  grantId: string;
  /** The HTTP status the homeserver answered. */
  status: number;
  /** The bearer it minted, for an accepted exchange. */
  token?: string;
};

export type RingNetwork = {
  /** Relay messages by `<host><path>`, and the browser's polls still waiting for one. */
  inbox: Map<string, Buffer>;
  waiting: { channel: string; route: Route }[];
  /** Capabilities of each grant exchanged at the homeserver. */
  exchangedGrants: string[][];
  /** Every grant exchange at the homeserver, in order. */
  grantExchanges: GrantSessionExchange[];
  /**
   * Grants the homeserver no longer accepts: signed out (`DELETE /auth/grant/session`), or added by
   * a test as revoked elsewhere, such as in the keychain's Authorized Apps.
   */
  revokedGrants: Set<string>;
  /** The grant each `DELETE /auth/grant/session` signed out (and so revoked), in order. */
  grantSignouts: string[];
  /** The key of each legacy cookie sign-in (`POST /session`), in order. */
  cookieSignins: string[];
  /** Every write (`PUT`) the homeserver received, as `<pubky-host> <path>`. */
  writes: string[];
  /** The bearer each write in `writes` carried, in the same order; `""` for none. */
  writeTokens: string[];
  /** Every request that reached Passport's relay. */
  relayRequests: string[];
};

/** A network that has seen nothing yet, for specs that answer Passport's relay themselves. */
export function newRingNetwork(): RingNetwork {
  return {
    inbox: new Map(),
    waiting: [],
    exchangedGrants: [],
    grantExchanges: [],
    revokedGrants: new Set(),
    grantSignouts: [],
    cookieSignins: [],
    writes: [],
    writeTokens: [],
    relayRequests: [],
  };
}

/**
 * Answers Passport's relay, the PKARR relays and `homeserver.example` for a Ring identity whose
 * public `profile.json` is `profile` (`null` for none). The grant exchange answers `grantStatus`.
 * As a homeserver does, each accepted exchange (the first after an approval, or a restore from the
 * browser's session store) mints its own bearer; signing a grant session out revokes its grant,
 * after which the grant's exchanges and its bearers' writes are refused (`401`). A legacy cookie
 * sign-in answers with its session. Other HTTPS requests fall through to the test's context routes.
 */
export async function mockRingNetwork(
  page: Page,
  { profile = null, grantStatus = 200 }: { profile?: object | null; grantStatus?: number } = {},
): Promise<RingNetwork> {
  const net = newRingNetwork();
  /** The grant behind each bearer the homeserver minted. */
  const bearers = new Map<string, string>();
  const bearerOf = (request: Request) =>
    /^Bearer (.+)$/u.exec(request.headers()["authorization"] ?? "")?.[1] ?? "";
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
        const status = net.revokedGrants.has(claims.jti) ? 401 : grantStatus;
        if (status !== 200) {
          net.grantExchanges.push({ grantId: claims.jti, status });
          return route.fulfill({ status, body: status === 401 ? "grant revoked" : "refused" });
        }
        const token = `e2e-bearer-${net.grantExchanges.length + 1}`;
        bearers.set(token, claims.jti);
        net.grantExchanges.push({ grantId: claims.jti, status, token });
        const now = Math.floor(Date.now() / 1000);
        return route.fulfill({
          json: {
            token,
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
      if (url.pathname === "/auth/grant/session" && method === "DELETE") {
        // Signing a grant session out revokes its grant; signing out again changes nothing.
        const grantId = bearers.get(bearerOf(request));
        if (grantId === undefined) return route.fulfill({ status: 401, body: "unauthorized" });
        net.grantSignouts.push(grantId);
        net.revokedGrants.add(grantId);
        return route.fulfill({ status: 200, body: "" });
      }
      if (url.pathname === "/session" && method === "POST") {
        const session = cookieSession(request.postDataBuffer() ?? Buffer.alloc(0));
        if (!session) return route.fulfill({ status: 400, body: "invalid auth token" });
        net.cookieSignins.push(session.publicKey);
        return route.fulfill({
          status: 201,
          body: session.info,
          contentType: "application/octet-stream",
          headers: {
            "set-cookie": `${session.publicKey}=${randomBytes(16).toString("base64url")}; Path=/; Secure; HttpOnly; SameSite=None`,
          },
        });
      }
      if (method === "PUT") {
        const token = bearerOf(request);
        const grantId = bearers.get(token);
        if (grantId !== undefined && net.revokedGrants.has(grantId))
          return route.fulfill({ status: 401, body: "grant revoked" });
        net.writes.push(`${owner} ${url.pathname}`);
        net.writeTokens.push(token);
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

/**
 * The legacy cookie sign-in's answer to a signed `AuthToken` (postcard: signature, namespace,
 * version, timestamp, the signer's public key, then its capabilities as one string): the
 * homeserver's `SessionInfo` for that key and those capabilities, in its postcard encoding.
 */
function cookieSession(token: Buffer): { publicKey: string; info: Buffer } | undefined {
  // The capabilities string ends the token, after its varint length and the 32-byte key.
  for (let length = 1; length <= token.length - 33; length++) {
    const capabilities = token.subarray(token.length - length).toString("latin1");
    const prefix = varint(length);
    const keyEnd = token.length - length - prefix.length;
    if (
      !/^\/[\x21-\x2b\x2d-\x7e]*:(?:rw|r|w)(?:,\/[\x21-\x2b\x2d-\x7e]*:(?:rw|r|w))*$/u.test(
        capabilities,
      ) ||
      keyEnd < 32 ||
      !token.subarray(keyEnd, keyEnd + prefix.length).equals(prefix)
    )
      continue;
    const key = token.subarray(keyEnd - 32, keyEnd);
    return { publicKey: z32(key), info: sessionInfo(key, capabilities.split(",")) };
  }
  // No capabilities at all (Passport's backup check): an empty string, its length a single zero.
  if (token.length >= 33 && token[token.length - 1] === 0) {
    const key = token.subarray(token.length - 33, token.length - 1);
    return { publicKey: z32(key), info: sessionInfo(key, []) };
  }
  return undefined;
}

/** The homeserver's `SessionInfo` (version 0) for `key` and `caps`, in its postcard encoding. */
function sessionInfo(key: Buffer, caps: string[]): Buffer {
  return Buffer.concat([
    Buffer.from([0]), // version
    key,
    varint(Date.now() * 1000), // created_at, in microseconds
    Buffer.from([0, 0]), // name and user agent, always empty
    varint(caps.length),
    ...caps.flatMap((cap) => [varint(Buffer.byteLength(cap)), Buffer.from(cap)]),
  ]);
}

/** `value` as a postcard (LEB128) varint. */
function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = BigInt(value);
  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest > 0n ? byte | 0x80 : byte);
  } while (rest > 0n);
  return Buffer.from(bytes);
}

/** `bytes` in z-base32, the form of a pubky's public key. */
function z32(bytes: Uint8Array): string {
  const alphabet = "ybndrfg8ejkmcpqxot1uwisza345h769";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
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
 * Plays Pubky Ring approving `url` with `RING_KEY` (or the key of another `seed`): the real SDK
 * signer signs it in the test process, and the encrypted approval lands in the mocked relay inbox
 * it was posted to.
 */
export async function ringApproves(
  net: RingNetwork,
  url: string,
  { seed = RING_SEED }: { seed?: number } = {},
): Promise<void> {
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
  const keypair = Keypair.fromSecret(new Uint8Array(32).fill(seed));
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
 * WebKit's Ed25519 `generateKey` now and then rejects with an `OperationError` (seen under load on
 * Linux WebKit). The SDK then keeps that flow's PoP key in memory, so no key ever reaches IndexedDB
 * and a spec counting stored keys cannot tell cleanup from a key that was never stored. This
 * retries such a generation in the page, which leaves every other engine and algorithm as it is.
 */
export async function retryFlakyEd25519KeyGeneration(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return;
    const generateKey = subtle.generateKey.bind(subtle) as (
      ...args: Parameters<SubtleCrypto["generateKey"]>
    ) => Promise<CryptoKey | CryptoKeyPair>;
    const ed25519 = (algorithm: unknown) =>
      (typeof algorithm === "string" ? algorithm : (algorithm as { name?: unknown })?.name) ===
      "Ed25519";
    Object.defineProperty(subtle, "generateKey", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["generateKey"]>) => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await generateKey(...args);
          } catch (e) {
            const flaky = e instanceof DOMException && e.name === "OperationError";
            if (!flaky || !ed25519(args[0]) || attempt >= 5) throw e;
          }
        }
      },
    });
  });
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

/** A session the SDK's browser session store keeps, without its credential. */
export type StoredSession = {
  publicKey: string;
  clientId: string;
  grantId: string;
  capabilities: string[];
  /** `delegated` (a non-extractable PoP key in IndexedDB) or `localSecret`. */
  storageMode: string;
};

/**
 * The sessions the SDK's browser session store keeps for this origin. The database is only read,
 * never created, so the SDK still sets it up on first use.
 */
export async function storedSessions(page: Page): Promise<StoredSession[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "pubky-auth")) return [];
    return new Promise<StoredSession[]>((resolve, reject) => {
      const open = indexedDB.open("pubky-auth");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("storedSessions")) {
          db.close();
          resolve([]);
          return;
        }
        const all = db
          .transaction("storedSessions", "readonly")
          .objectStore("storedSessions")
          .getAll();
        all.onsuccess = () => {
          db.close();
          resolve(
            (all.result as StoredSession[]).map(
              ({ publicKey, clientId, grantId, capabilities, storageMode }) => ({
                publicKey,
                clientId,
                grantId,
                capabilities,
                storageMode,
              }),
            ),
          );
        };
        all.onerror = () => {
          db.close();
          reject(all.error);
        };
      };
    });
  });
}
