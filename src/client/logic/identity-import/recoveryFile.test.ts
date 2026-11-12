import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import { hasRecoveryFileShape, MAXIMUM_RECOVERY_FILE_BYTES } from "./recoveryFile";

/**
 * Fixed bytes written once by the pinned SDK's `createRecoveryFile` (the SDK function pubky.app
 * also uses) for the secret of the "legal winner … yellow" phrase vector. Not an export from
 * pubky.app or Ring itself. The legacy file is the same file with the
 * older `pkarr.org/recovery` spec line, which the SDK still reads.
 */
const FIXTURES = [
  { name: "recovery.pkarr", specLine: "pubky.org/recovery\n" },
  { name: "recovery-legacy.pkarr", specLine: "pkarr.org/recovery\n" },
] as const;
const FIXTURE_PASSWORD = "fixture password 284";
const FIXTURE_PUBLIC_KEY = "a53kaica1hg81a3znuj6szbw469h84jpwsg8gifuxgmpujfx8k3y";

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "src/client/logic/identity-import/fixtures", name)),
  );
}

function withSpecLine(specLine: string, body = new Uint8Array(72).fill(1)): Uint8Array {
  return new Uint8Array([...new TextEncoder().encode(specLine), ...body]);
}

describe("recovery file shape", () => {
  it.each(FIXTURES)("accepts the $specLine spec line", ({ specLine }) => {
    expect(hasRecoveryFileShape(withSpecLine(specLine))).toBe(true);
  });

  it.each([
    ["another spec line", withSpecLine("example.org/recovery\n")],
    ["a spec line without a newline", withSpecLine("pkarr.org/recovery ")],
    ["only the spec line", withSpecLine("pkarr.org/recovery\n", new Uint8Array(0))],
    ["a file over the size limit", withSpecLine("pubky.org/recovery\n", new Uint8Array(1024))],
  ])("rejects %s", (_label, bytes) => {
    expect(hasRecoveryFileShape(bytes)).toBe(false);
  });

  it("keeps the size limit inclusive", () => {
    const header = withSpecLine("pubky.org/recovery\n", new Uint8Array(0));
    const atLimit = withSpecLine(
      "pubky.org/recovery\n",
      new Uint8Array(MAXIMUM_RECOVERY_FILE_BYTES - header.byteLength),
    );
    expect(hasRecoveryFileShape(atLimit)).toBe(true);
  });
});

describe("recovery file fixtures", () => {
  it.each(FIXTURES)("recovers the expected pubky from $name", ({ name, specLine }) => {
    const bytes = fixture(name);
    expect(new TextDecoder().decode(bytes.subarray(0, specLine.length))).toBe(specLine);
    const pubky = new PubkySdkAdapter();
    try {
      const imported = pubky.importRecoveryFile(bytes, FIXTURE_PASSWORD);
      if (Result.isError(imported)) throw new Error(imported.error.code);
      expect(imported.value.publicIdentity.publicKeyZ32).toBe(FIXTURE_PUBLIC_KEY);
      // The caller's bytes are cleared.
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    } finally {
      pubky.dispose();
    }
  });

  it.each(FIXTURES)("reports a wrong password for $name as undecryptable", ({ name }) => {
    const pubky = new PubkySdkAdapter();
    try {
      const imported = pubky.importRecoveryFile(fixture(name), "not the password");
      expect(Result.isError(imported) && imported.error.code).toBe("recovery_file_undecryptable");
    } finally {
      pubky.dispose();
    }
  });
});
