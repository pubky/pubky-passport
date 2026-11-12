import "client-only";

import { mnemonicToEntropy, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Result, type Result as ResultType } from "better-result";

import type { CodedFailure } from "@/libs/result";
import {
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";

/** pubky.app and Pubky Ring use 12-word phrases (128-bit BIP39 entropy). */
export const RECOVERY_PHRASE_WORD_COUNT = 12;

const WORDS = new Set(wordlist);
/** Spaces, line breaks, commas, and the `-` `_` `+` separators Pubky Ring accepts. */
const WORD_SEPARATORS = /[\s,\-_+]+/u;

export type RecoveryPhraseErrorCode = "invalid_checksum" | "invalid_word" | "invalid_word_count";
export type RecoveryPhraseSecretKeyResult = ResultType<
  PubkySecretKeyMaterial,
  CodedFailure<RecoveryPhraseErrorCode>
>;

/** Lowercases and trims one typed word. */
export function normalizeRecoveryWord(value: string): string {
  return value.trim().toLowerCase();
}

/** Splits pasted text into lowercase words. */
export function splitRecoveryPhrase(value: string): string[] {
  return value
    .split(WORD_SEPARATORS)
    .map(normalizeRecoveryWord)
    .filter((word) => word.length > 0);
}

/** True for a word of the BIP39 English wordlist. */
export function isRecoveryPhraseWord(word: string): boolean {
  return WORDS.has(word);
}

/**
 * Derives a Pubky secret key from a 12-word recovery phrase the way pubky.app and Pubky Ring do:
 * the BIP39 seed with an empty passphrase (PBKDF2-HMAC-SHA512, 2048 rounds), whose first 32 bytes
 * are the ed25519 secret key. No BIP32 path.
 *
 * Entropy and seed bytes are zeroed after use. The phrase itself is a JS string and cannot be
 * wiped; callers drop their references as soon as the key is derived.
 */
export async function deriveSecretKeyFromRecoveryPhrase(
  words: readonly string[],
): Promise<RecoveryPhraseSecretKeyResult> {
  if (words.length !== RECOVERY_PHRASE_WORD_COUNT) {
    return Result.err({ code: "invalid_word_count" });
  }
  if (!words.every(isRecoveryPhraseWord)) return Result.err({ code: "invalid_word" });

  const phrase = words.join(" ");
  let entropy: Uint8Array;
  try {
    entropy = mnemonicToEntropy(phrase, wordlist);
  } catch {
    // The library's message is not logged or returned: it may describe the phrase.
    return Result.err({ code: "invalid_checksum" });
  }
  entropy.fill(0);

  const seed = await mnemonicToSeed(phrase, "");
  try {
    return Result.ok({
      bytes: seed.slice(0, PUBKY_SECRET_KEY_BYTES),
      format: PUBKY_SECRET_KEY_FORMAT,
    });
  } finally {
    seed.fill(0);
  }
}
