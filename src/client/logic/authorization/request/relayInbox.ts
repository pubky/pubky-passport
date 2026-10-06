import "client-only";

import { blake3 } from "@noble/hashes/blake3.js";

/**
 * The URL that tells whether the app has taken the answer on its relay channel, or `undefined`
 * when the relay offers no such look. The SDK listens on `base64url(blake3(secret))` appended as a
 * path segment to the request's relay (checked against `@synonymdev/pubky` 0.11.0), and Pubky
 * Ring posts its approval there. On an inbox relay `GET <channel>/ack` only reads: `404` while
 * nothing was posted, `false` once Ring posted and `true` once the app acknowledged it, so looking
 * never takes, changes or acknowledges the message the app must receive. The legacy `/link`
 * channel has no such look (its `GET` is the delivery), so a request on it gets none.
 *
 * The result carries the channel ID, a bearer secret for that inbox: never log or store it.
 */
export function relayAnswerAckUrl(pubkyAuthUrl: string): string | undefined {
  let request: URL;
  let relay: URL;
  try {
    request = new URL(pubkyAuthUrl);
    relay = new URL(request.searchParams.get("relay") ?? "");
  } catch {
    return undefined;
  }
  const secret = decodeBase64Url(request.searchParams.get("secret") ?? "");
  if (relay.protocol !== "https:" || !secret || secret.length !== 32) return undefined;

  const segments = relay.pathname.split("/").filter((segment, index, all) => {
    return !(segment === "" && (index === 0 || index === all.length - 1));
  });
  if (segments.at(-1) === "link") return undefined;
  segments.push(encodeBase64Url(blake3(secret)), "ack");
  relay.pathname = `/${segments.join("/")}`;
  relay.hash = "";
  return relay.href;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return undefined;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
