/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { browserPassportSessionLedger as ledger } from "./passportSessionLedger";

const PREFIX = "pubky-passport/open-sessions/v1/";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("browserPassportSessionLedger", () => {
  it("records grants per identity and forgets them", () => {
    tickingClock();
    ledger.record("alice", "grant-1");
    ledger.record("alice", "grant-2");
    ledger.record("bob", "grant-3");

    expect([...ledger.recorded("alice")]).toEqual(["grant-1", "grant-2"]);
    expect([...ledger.recorded("bob")]).toEqual(["grant-3"]);

    ledger.forget("alice", ["grant-1", "unknown"]);
    expect([...ledger.recorded("alice")]).toEqual(["grant-2"]);
    expect([...ledger.recorded("bob")]).toEqual(["grant-3"]);

    ledger.forget("alice", ["grant-2"]);
    ledger.forget("bob", ["grant-3"]);
    expect(localStorage.length).toBe(0);
  });

  it("keeps each grant in its own key so tabs never overwrite each other", () => {
    ledger.record("alice", "tab-a");
    // Another tab records while this one forgets: neither change can undo the other.
    localStorage.setItem(`${PREFIX}alice/tab-b`, "1");
    ledger.forget("alice", ["tab-a"]);

    expect([...ledger.recorded("alice")]).toEqual(["tab-b"]);
  });

  it("keeps only the newest 32 grants of an identity", () => {
    tickingClock();
    for (let i = 0; i < 40; i += 1) ledger.record("alice", `grant-${i}`);
    ledger.record("bob", "grant-b");

    const recorded = [...ledger.recorded("alice")];
    expect(recorded).toHaveLength(32);
    expect(recorded[0]).toBe("grant-8");
    expect(recorded.at(-1)).toBe("grant-39");
    expect([...ledger.recorded("bob")]).toEqual(["grant-b"]);
  });

  it("ignores ids that are empty, too long or would add a key segment", () => {
    for (const id of ["", "a/b", "x".repeat(129)]) {
      ledger.record("alice", id);
      ledger.record(id, "grant-1");
    }
    localStorage.setItem(`${PREFIX}alice/nested/grant`, "1");
    localStorage.setItem(`${PREFIX}alice-other/grant`, "1");

    expect(ledger.recorded("alice").size).toBe(0);
    expect(ledger.recorded("a/b").size).toBe(0);
  });

  it("reads a record with a malformed timestamp as the oldest", () => {
    tickingClock();
    ledger.record("alice", "grant-new");
    localStorage.setItem(`${PREFIX}alice/grant-odd`, "not a number");

    expect([...ledger.recorded("alice")]).toEqual(["grant-odd", "grant-new"]);
  });

  it("never throws when storage fails", () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    localStorage.setItem("unrelated", "1"); // so reading the records calls key()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SECRET-STORAGE-CANARY");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SECRET-STORAGE-CANARY");
    });
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("SECRET-STORAGE-CANARY");
    });

    expect(() => ledger.record("alice", "grant-1")).not.toThrow();
    expect(() => ledger.forget("alice", ["grant-1"])).not.toThrow();
    expect(ledger.recorded("alice").size).toBe(0);
    for (const operation of ["record", "forget", "read"]) {
      expect(warn).toHaveBeenCalledWith(
        "identity.pubky.session_ledger.failed",
        expect.objectContaining({ operation, code: "storage_unavailable" }),
      );
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-STORAGE-CANARY");
  });
});

function tickingClock(): void {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (now += 1));
}
