import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { Keypair } from "@synonymdev/pubky";
import type { Page } from "@playwright/test";

import { PKARR_RELAY_HOSTS } from "./network";

const keypair = Keypair.fromSecret(new Uint8Array(32).fill(1));
const publicKey = keypair.publicKey;
export const PROFILE_KEY = publicKey.z32();
publicKey.free();
keypair.free();
const homeserverKeypair = Keypair.fromSecret(new Uint8Array(32).fill(2));
const homeserver = homeserverKeypair.publicKey;
/** The test homeserver's key; {@link homeserverRecord} places it at `homeserver.example`. */
export const HOMESERVER = homeserver.z32();
homeserver.free();
homeserverKeypair.free();
export const IDENTITY_STORAGE_KEY = `pubky-passport/local-identities/v1/identity/${PROFILE_KEY}`;
const AVATAR = readFileSync("e2e/fixtures/profile-avatar.png");

// Real, signed PKARR fixtures exercise the browser SDK's resolution and public storage.
function packet(seed: number, name: string, target: string) {
  const dnsName = (value: string) =>
    Buffer.concat([
      ...value
        .split(".")
        .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
      Buffer.from([0]),
    ]);
  const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  const rdata = Buffer.concat([Buffer.from([0, 0]), dnsName(target)]);
  const record = Buffer.alloc(10);
  record.writeUInt16BE(65, 0);
  record.writeUInt16BE(1, 2);
  record.writeUInt32BE(3600, 4);
  record.writeUInt16BE(rdata.length, 8);
  const dns = Buffer.concat([header, dnsName(name), record, rdata]);
  const timestamp = BigInt(Date.now()) * 1000n;
  const sequence = Buffer.alloc(8);
  sequence.writeBigUInt64BE(timestamp);
  const secret = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.alloc(32, seed),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(`3:seqi${timestamp}e1:v${dns.length}:`), dns]),
    secret,
  );
  return Buffer.concat([signature, sequence, dns]);
}
/**
 * The signed PKARR record a relay serves for `key`: `PROFILE_KEY` names the test homeserver, whose
 * own record places it at `domain`. Other keys have no record.
 */
export function homeserverRecord(key: string, domain = "homeserver.example"): Buffer | null {
  if (key === PROFILE_KEY) return packet(1, `_pubky.${PROFILE_KEY}`, HOMESERVER);
  return key === HOMESERVER ? packet(2, HOMESERVER, domain) : null;
}

/** Answers PKARR relay lookups with {@link homeserverRecord}. */
export async function mockHomeserverRecords(page: Page, domain?: string) {
  await page.route(
    (url) => PKARR_RELAY_HOSTS.has(url.hostname),
    async (route) => {
      const body = homeserverRecord(new URL(route.request().url()).pathname.slice(1), domain);
      await route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    },
  );
}

/**
 * Serves a signed PKARR record, `profile` as the identity's `profile.json` (`null` for none) and a
 * PNG avatar. Any other homeserver request, such as a session for publishing, gets a 503.
 */
export async function mockPublicProfile(page: Page, profile: object | null) {
  await page.route(/^https:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, async (route) => {
    const url = new URL(route.request().url());
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      const body = homeserverRecord(url.pathname.slice(1));
      await route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    } else if (
      url.hostname === "homeserver.example" &&
      url.pathname.endsWith("/pub/pubky.app/profile.json")
    ) {
      await route.fulfill(profile ? { status: 200, json: profile } : { status: 404 });
    } else if (
      url.hostname === "homeserver.example" &&
      url.pathname.endsWith("/pub/pubky.app/files/AVATAR")
    ) {
      await route.fulfill({
        json: {
          name: "avatar.png",
          created_at: Date.now() * 1000,
          src: `pubky://${PROFILE_KEY}/pub/pubky.app/blobs/AVATAR`,
          content_type: "image/png",
          size: AVATAR.byteLength,
        },
      });
    } else if (
      url.hostname === "homeserver.example" &&
      url.pathname.endsWith("/pub/pubky.app/blobs/AVATAR")
    ) {
      await route.fulfill({ body: AVATAR, contentType: "application/octet-stream" });
    } else if (url.hostname === "homeserver.example") {
      await route.fulfill({ status: 503, body: "Service unavailable" });
    } else await route.abort();
  });
}
export async function seedProfileIdentity(page: Page, pending = true) {
  await page.goto("/");
  await page.evaluate(
    ({ key, storageKey, pending }) => {
      localStorage.clear();
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          publicKeyZ32: key,
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          ...(pending ? { profileSetupRequired: true } : {}),
        }),
      );
      localStorage.setItem("pubky-passport/local-identities/v1/active", key);
    },
    { key: PROFILE_KEY, storageKey: IDENTITY_STORAGE_KEY, pending },
  );
  await page.reload();
}
