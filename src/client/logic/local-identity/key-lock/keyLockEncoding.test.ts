import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import {
  enc,
  createKekInfo,
  createWrappedDekAdditionalData,
  createSeedAdditionalData,
  createScrubDigestInput,
} from "./keyLockEncoding";

const vaultId = encodeBase64Url(new Uint8Array(16).fill(1));
const slot = {
  slotId: encodeBase64Url(new Uint8Array(16).fill(2)),
  credentialId: encodeBase64Url(new Uint8Array(16).fill(3)),
  prfInput: encodeBase64Url(new Uint8Array(32).fill(4)),
};
const origin = "https://passport.example";
const publicKeyZ32 = "y".repeat(52);

// Independent Node Buffer framing keeps byte ordering and lengths observable.
function framed(fields: string[]): Uint8Array {
  return Uint8Array.from(
    Buffer.concat(
      fields.flatMap((field) => {
        const bytes = Buffer.from(field, "ascii");
        const length = Buffer.alloc(2);
        length.writeUInt16BE(bytes.length);
        return [length, bytes];
      }),
    ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("key-lock encodings", () => {
  it("encodes ASCII fields with unsigned big-endian lengths and no separators", () => {
    expect(expectResultOk(enc(["A", "", "BC"]))).toEqual(
      new Uint8Array([0, 1, 65, 0, 0, 0, 2, 66, 67]),
    );
    expect(expectResultOk(enc([]))).toEqual(new Uint8Array());
    expect(expectResultOk(enc(["a".repeat(256)])).subarray(0, 2)).toEqual(new Uint8Array([1, 0]));
    expect(expectResultOk(enc(["a".repeat(2048)]))).toEqual(framed(["a".repeat(2048)]));
  });

  it.each(["é", "😀", "a".repeat(2049)])(
    "rejects non-ASCII and overlong fields as programming errors",
    (field) => {
      expectResultError(enc([field]), { code: "invalid_encoding" });
    },
  );

  it("uses exact KEK and wrapped-DEK labels and authenticated field order", () => {
    expect(expectResultOk(createKekInfo({ vaultId }, slot))).toEqual(
      framed(["pubky-passport/key-lock/kek", "v2", vaultId, slot.slotId, slot.credentialId]),
    );
    expect(expectResultOk(createWrappedDekAdditionalData({ origin, vaultId }, slot))).toEqual(
      framed([
        "pubky-passport/key-lock/dek",
        "v2",
        origin,
        vaultId,
        slot.slotId,
        slot.credentialId,
        slot.prfInput,
        "hkdf-sha256",
      ]),
    );
  });

  it.each(["identity", "draft"] as const)("binds the %s seed's kind and public key", (kind) => {
    expect(
      expectResultOk(createSeedAdditionalData({ origin, vaultId }, { kind, publicKeyZ32 })),
    ).toEqual(framed(["pubky-passport/key-lock/seed", "v2", origin, vaultId, kind, publicKeyZ32]));
  });

  it("builds the scrub input from raw IV/ciphertext and UTF-8 source, without length prefixes", () => {
    const iv = new Uint8Array(12).fill(5);
    const ct = new Uint8Array(48).fill(6);
    const source = '{"name":"Zoë 東京"}';
    const input = expectResultOk(
      createScrubDigestInput({ iv: encodeBase64Url(iv), ct: encodeBase64Url(ct) }, source),
    );
    expect(input).toEqual(
      Uint8Array.from(
        Buffer.concat([
          Buffer.from("pubky-passport/key-lock/scrub-digest/v2\0"),
          iv,
          ct,
          Buffer.from(source, "utf8"),
        ]),
      ),
    );
    input.fill(0);
  });

  it("refuses malformed seal bytes in the scrub input", () => {
    expectResultError(
      createScrubDigestInput({ iv: "bad", ct: encodeBase64Url(new Uint8Array(48)) }, "source"),
      { code: "invalid_encoding" },
    );
    expectResultError(
      createScrubDigestInput({ iv: encodeBase64Url(new Uint8Array(12)), ct: "bad" }, "source"),
      { code: "invalid_encoding" },
    );
  });

  it.each(["x\ud800", "x\udc00"])("refuses lossy UTF-8 source strings", (source) => {
    expectResultError(
      createScrubDigestInput(
        { iv: encodeBase64Url(new Uint8Array(12)), ct: encodeBase64Url(new Uint8Array(48)) },
        source,
      ),
      { code: "invalid_encoding" },
    );
  });

  it.each([false, true])("clears temporary source bytes on assembly failure=%s", (fails) => {
    const source = '{"synthetic":"source"}';
    const copies: Uint8Array[] = [];
    const encode = TextEncoder.prototype.encode;
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      text,
    ) {
      const bytes = encode.call(this, text);
      if (text === source) copies.push(bytes);
      return bytes;
    });
    if (fails)
      vi.spyOn(Uint8Array.prototype, "set").mockImplementationOnce(() => {
        throw new Error("synthetic assembly failure");
      });
    const result = createScrubDigestInput(
      { iv: encodeBase64Url(new Uint8Array(12)), ct: encodeBase64Url(new Uint8Array(48)) },
      source,
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toEqual(new Uint8Array(source.length));
    if (fails) expectResultError(result, { code: "invalid_encoding" });
    else {
      const input = expectResultOk(result);
      expect(new TextDecoder().decode(input.subarray(-source.length))).toBe(source);
      input.fill(0);
    }
  });
  it("contains an authenticated-field encoding failure without parser diagnostics", () => {
    vi.spyOn(TextEncoder.prototype, "encodeInto").mockImplementationOnce(() => {
      throw new Error("synthetic encoder failure");
    });
    expectResultError(enc(["field"]), { code: "invalid_encoding" });
  });
});
