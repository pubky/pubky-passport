import { mnemonicToSeed } from "@scure/bip39";
import { Keypair } from "@synonymdev/pubky";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { expectResultError } from "@test-utils/resultAssertions";
import { PUBKY_SECRET_KEY_FORMAT } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  deriveSecretKeyFromRecoveryPhrase,
  isRecoveryPhraseWord,
  normalizeRecoveryWord,
  RECOVERY_PHRASE_WORD_COUNT,
  splitRecoveryPhrase,
} from "./recoveryPhrase";

/** The first BIP39 English test vector (trezor/python-mnemonic vectors.json). */
const BIP39_VECTOR = {
  phrase:
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  seedWithTrezorPassphrase:
    "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
};

/**
 * Produced by pubky.app's own code path (src/libs/identity/identity.ts keypairFromMnemonic:
 * bip39 3.1.2 mnemonicToSeedSync, first 32 bytes, @synonymdev/pubky 0.17.1 Keypair.fromSecret),
 * run on 2026-11-12. Pubky Ring derives the same way (pubky-core-ffi src/keypair.rs).
 */
const PUBKY_APP_VECTORS = [
  {
    phrase:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    secretKeyHex: "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1",
    publicKeyZ32: "aihfhgdfshrj8nz9ofo7khayc1mgcqa4wrrdjahs5tmgo4pna3iy",
  },
  {
    phrase: "legal winner thank year wave sausage worth useful legal winner thank yellow",
    secretKeyHex: "878386efb78845b3355bd15ea4d39ef97d179cb712b77d5c12b6be415fffeffe",
    publicKeyZ32: "a53kaica1hg81a3znuj6szbw469h84jpwsg8gifuxgmpujfx8k3y",
  },
  {
    phrase: "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
    secretKeyHex: "b6a6d8921942dd9806607ebc2750416b289adea669198769f2e15ed926c3aa92",
    publicKeyZ32: "33g8xz1gd6bxg6bdo3h3dmsymuddaaajw56quqgaix43jyxu7tsy",
  },
] as const;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("recovery phrase derivation", () => {
  it("uses a BIP39 library that matches the standard test vector", async () => {
    expect(hex(await mnemonicToSeed(BIP39_VECTOR.phrase, "TREZOR"))).toBe(
      BIP39_VECTOR.seedWithTrezorPassphrase,
    );
  });

  it.each(PUBKY_APP_VECTORS)(
    "derives the same key as pubky.app for $publicKeyZ32",
    async ({ phrase, publicKeyZ32, secretKeyHex }) => {
      const result = await deriveSecretKeyFromRecoveryPhrase(phrase.split(" "));
      if (Result.isError(result)) throw new Error(result.error.code);
      expect(result.value.format).toBe(PUBKY_SECRET_KEY_FORMAT);
      expect(hex(result.value.bytes)).toBe(secretKeyHex);
      const keypair = Keypair.fromSecret(result.value.bytes);
      try {
        expect(keypair.publicKey.z32()).toBe(publicKeyZ32);
      } finally {
        keypair.free();
      }
    },
  );

  it("rejects a wrong word count, words outside the wordlist and a bad checksum", async () => {
    const words = PUBKY_APP_VECTORS[1].phrase.split(" ");
    expectResultError(await deriveSecretKeyFromRecoveryPhrase(words.slice(0, 11)), {
      code: "invalid_word_count",
    });
    expectResultError(await deriveSecretKeyFromRecoveryPhrase([...words, "abandon"]), {
      code: "invalid_word_count",
    });
    // pubky.app's UI offers 12 inputs only; a valid 24-word phrase is not accepted either.
    expectResultError(
      await deriveSecretKeyFromRecoveryPhrase([...Array<string>(23).fill("abandon"), "art"]),
      { code: "invalid_word_count" },
    );
    expectResultError(await deriveSecretKeyFromRecoveryPhrase([...words.slice(0, 11), "pubky"]), {
      code: "invalid_word",
    });
    expectResultError(
      await deriveSecretKeyFromRecoveryPhrase(
        Array<string>(RECOVERY_PHRASE_WORD_COUNT).fill("zoo"),
      ),
      { code: "invalid_checksum" },
    );
    // Swapping two words keeps every word valid but breaks the checksum.
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expectResultError(await deriveSecretKeyFromRecoveryPhrase(swapped), {
      code: "invalid_checksum",
    });
  });
});

describe("recovery phrase input", () => {
  it.each([
    ["spaces", "legal winner thank"],
    ["line breaks and tabs", "legal\nwinner\r\n\tthank"],
    ["dashes", "legal-winner-thank"],
    ["underscores and plus signs", "legal_winner+thank"],
    ["commas and extra space", "  legal, winner ,thank  "],
    ["capitals", "Legal WINNER Thank"],
  ])("splits pasted words separated by %s", (_label, text) => {
    expect(splitRecoveryPhrase(text)).toEqual(["legal", "winner", "thank"]);
  });

  it("normalizes and checks single words against the English wordlist", () => {
    expect(normalizeRecoveryWord("  Abandon ")).toBe("abandon");
    expect(isRecoveryPhraseWord("abandon")).toBe(true);
    expect(isRecoveryPhraseWord("zoo")).toBe(true);
    expect(isRecoveryPhraseWord("pubky")).toBe(false);
    expect(isRecoveryPhraseWord("Abandon")).toBe(false);
    expect(isRecoveryPhraseWord("")).toBe(false);
    expect(splitRecoveryPhrase(" \n ")).toEqual([]);
  });
});
