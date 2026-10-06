/** @vitest-environment jsdom */
import { Result } from "better-result";
import { expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import type {
  PubkyProfileGrantResult,
  PubkyRingVerificationTransport,
  RingProfileGrant,
} from "../pubky/PubkySdkAdapter";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";
import { PUBKY_SECRET_KEY_FORMAT } from "../pubky/pubkyIdentityKey";
import { RingBackupVerifier } from "./RingBackupVerifier";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const URL = "pubkyauth://signin_grant?caps=&secret=VERIFY-REQUEST-SECRET";
const RELAY = "https://relay.passport.example/inbox";
const NOW = Date.UTC(2026, 9, 1, 12);

function setup() {
  localStorage.clear();
  const repository = new LocalStorageIdentityRepository();
  expectResultOk(
    repository.save(
      { publicIdentity: { publicKeyZ32: KEY } },
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ),
  );
  const connection = {
    authorizationUrl: vi.fn(() => URL),
    poll: vi.fn(async (): Promise<PubkyProfileGrantResult<string | undefined>> =>
      Result.ok(undefined),
    ),
    dispose: vi.fn(async () => undefined),
  };
  const start = vi.fn<Pick<PubkyRingVerificationTransport, "start">["start"]>(async () =>
    Result.ok(connection as unknown as RingProfileGrant),
  );
  let now = NOW;
  const verifier = new RingBackupVerifier(RELAY, repository, { start }, () => now);
  const backup = () => expectResultOk(repository.read(KEY)).identity.backup;
  return {
    backup,
    connection,
    start,
    verifier,
    later: (ms: number) => {
      now += ms;
    },
  };
}

it("records the verification when Pubky Ring approves with this key, then signs the Session out", async () => {
  const { backup, connection, start, verifier } = setup();
  expectResultOk(await verifier.start(KEY));
  expect(start).toHaveBeenCalledExactlyOnceWith(RELAY);
  expect(verifier.authorizationUrl()).toBe(URL);
  expect(expectResultOk(await verifier.poll())).toEqual({ status: "waiting" });
  expect(backup()).toBeUndefined();

  connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(expectResultOk(await verifier.poll())).toEqual({ status: "verified", at: new Date(NOW) });
  // The Session served the check only: it is released at once, and the link is gone.
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(verifier.authorizationUrl()).toBeUndefined();
  expect(backup()).toEqual({ ringVerifiedAt: new Date(NOW).toISOString() });
});

it("refuses an approval signed with another pubky and records nothing", async () => {
  const { backup, connection, verifier } = setup();
  expectResultOk(await verifier.start(KEY));
  connection.poll.mockResolvedValue(Result.ok(OTHER));

  expectResultError(await verifier.poll(), { code: "wrong_identity" });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(backup()).toBeUndefined();
  // The verification is over: nothing more is polled.
  expectResultError(await verifier.poll(), { code: "cancelled" });
});

it("expires after five minutes without an approval, recording nothing", async () => {
  const { backup, connection, later, verifier } = setup();
  expectResultOk(await verifier.start(KEY));
  later(5 * 60_000);
  expect(verifier.authorizationUrl()).toBeUndefined();
  expectResultError(await verifier.poll(), { code: "expired" });
  expect(connection.poll).not.toHaveBeenCalled();
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(backup()).toBeUndefined();
});

it.each([
  ["grant_rejected", "grant_rejected"],
  ["homeserver_unresolved", "homeserver_unresolved"],
  ["grant_failed", "connection_failed"],
] as const)("reports a %s poll as %s and records nothing", async (sdkCode, code) => {
  const { backup, connection, verifier } = setup();
  expectResultOk(await verifier.start(KEY));
  connection.poll.mockResolvedValue(Result.err({ code: sdkCode }));
  expect(await verifier.poll()).toMatchObject({ error: { code } });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(backup()).toBeUndefined();
});

it("says when the check could not be saved", async () => {
  const { connection, verifier } = setup();
  expectResultOk(await verifier.start(KEY));
  localStorage.clear(); // The identity is gone by the time Ring approves.
  connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(await verifier.poll()).toMatchObject({ error: { code: "storage_failed" } });
});

it("refuses to start for a malformed key, and when no request can be made", async () => {
  const { start, verifier } = setup();
  expectResultError(await verifier.start("not-a-pubky"), { code: "wrong_identity" });
  expect(start).not.toHaveBeenCalled();
  start.mockResolvedValueOnce(Result.err({ code: "grant_failed" }));
  expect(await verifier.start(KEY)).toMatchObject({ error: { code: "request_failed" } });
});

it("releases a request that finished starting after it was disposed", async () => {
  const { connection, start, verifier } = setup();
  let finish: (result: PubkyProfileGrantResult<RingProfileGrant>) => void = () => undefined;
  start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const started = verifier.start(KEY);
  await vi.waitFor(() => expect(start).toHaveBeenCalled());
  verifier.dispose();
  finish(Result.ok(connection as unknown as RingProfileGrant));
  expectResultError(await started, { code: "cancelled" });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(verifier.authorizationUrl()).toBeUndefined();
});
