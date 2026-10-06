import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "@/libs/encoding/base64Url";
import type { CodedFailure } from "@/libs/result";
import { isRecord } from "@/libs/typeGuards";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import {
  isPubkyPublicKey,
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyPublicIdentity,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";

const STORAGE_KEY = "pubky-passport/local-account-draft/v1";
const storedDraftSchema = z.strictObject({
  v: z.literal(1),
  publicKeyZ32: z.string().refine(isPubkyPublicKey),
  secretKey: z.string().length(43).refine(isCanonicalBase64Url),
  homeserverPubky: z.string().refine(isPubkyPublicKey),
  signupToken: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => value.trim().length > 0),
  step: z.enum(["password", "confirm"]),
  registrationStarted: z.boolean().optional(),
});
type StoredDraft = z.infer<typeof storedDraftSchema>;
export type LocalAccountDraft = {
  publicIdentity: PubkyPublicIdentity;
  invite: HomeserverSignupDetails;
  step: "password" | "confirm";
  registrationStarted?: boolean;
};
type DraftResult<T> = ResultType<
  T,
  CodedFailure<"storage_unavailable" | "invalid_draft" | "draft_conflict">
>;

/**
 * Keeps one unfinished account across navigation and reloads, outside the signing catalog.
 * Only the setup controller can restore its secret; UI reads receive public metadata and the
 * bound invite. Backup passwords and authorization requests are never part of this record.
 */
export class LocalAccountDraftRepository {
  constructor(private readonly storage: () => Storage = () => globalThis.localStorage) {}

  read(): DraftResult<LocalAccountDraft | null> {
    const stored = this.readStored();
    return Result.isError(stored)
      ? Result.err(stored.error)
      : Result.ok(stored.value ? metadata(stored.value) : null);
  }

  restore(): DraftResult<{ draft: LocalAccountDraft; secretKey: PubkySecretKeyMaterial } | null> {
    const stored = this.readStored();
    if (Result.isError(stored)) return Result.err(stored.error);
    if (!stored.value) return Result.ok(null);
    const bytes = decodeBase64Url(stored.value.secretKey);
    if (!bytes || bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      bytes?.fill(0);
      return Result.err({ code: "invalid_draft" });
    }
    return Result.ok({
      draft: metadata(stored.value),
      secretKey: { bytes, format: PUBKY_SECRET_KEY_FORMAT },
    });
  }

  create(draft: LocalAccountDraft, secretKey: PubkySecretKeyMaterial): DraftResult<void> {
    const existing = this.readStored();
    if (Result.isError(existing)) return Result.err(existing.error);
    if (existing.value) return Result.err({ code: "draft_conflict" });
    if (
      secretKey.format !== PUBKY_SECRET_KEY_FORMAT ||
      secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
    ) {
      return Result.err({ code: "invalid_draft" });
    }
    const stored = {
      v: 1 as const,
      publicKeyZ32: draft.publicIdentity.publicKeyZ32,
      secretKey: encodeBase64Url(secretKey.bytes),
      ...draft.invite,
      step: draft.step,
    };
    if (!storedDraftSchema.safeParse(stored).success) return Result.err({ code: "invalid_draft" });
    return this.write(stored);
  }

  setStep(publicKeyZ32: string, step: LocalAccountDraft["step"]): DraftResult<void> {
    const stored = this.readStored();
    if (Result.isError(stored)) return Result.err(stored.error);
    if (stored.value?.publicKeyZ32 !== publicKeyZ32) return Result.err({ code: "draft_conflict" });
    return this.write({ ...stored.value, step });
  }

  markRegistrationStarted(publicKeyZ32: string): DraftResult<void> {
    const stored = this.readStored();
    if (Result.isError(stored)) return Result.err(stored.error);
    if (stored.value?.publicKeyZ32 !== publicKeyZ32) return Result.err({ code: "draft_conflict" });
    return this.write({ ...stored.value, registrationStarted: true });
  }

  /** Switching signer is safe until the invite has been submitted to the homeserver. */
  discardUnregistered(): DraftResult<void> {
    const stored = this.readStored();
    if (Result.isError(stored)) return Result.err(stored.error);
    if (!stored.value) return Result.ok();
    if (stored.value.registrationStarted) return Result.err({ code: "draft_conflict" });
    return this.remove(stored.value.publicKeyZ32);
  }

  /**
   * Removes a stored draft that cannot be read but still holds a secret key. That key may own
   * an account, so call this only after the person confirmed losing it. Readable drafts are
   * left to `remove` and `discardUnregistered`.
   */
  removeUnreadable(): DraftResult<void> {
    const stored = this.readStored();
    if (Result.isOk(stored))
      return stored.value ? Result.err({ code: "draft_conflict" }) : Result.ok();
    if (stored.error.code !== "invalid_draft") return Result.err(stored.error);
    return this.removeStored();
  }

  remove(publicKeyZ32: string): DraftResult<void> {
    const stored = this.readStored();
    if (Result.isError(stored)) return Result.err(stored.error);
    if (!stored.value) return Result.ok();
    if (stored.value.publicKeyZ32 !== publicKeyZ32) return Result.err({ code: "draft_conflict" });
    return this.removeStored();
  }

  private readStored(): DraftResult<StoredDraft | null> {
    let raw: string | null;
    try {
      raw = this.storage().getItem(STORAGE_KEY);
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
    if (raw === null) return Result.ok(null);
    const parsed = parseStoredValue(raw);
    const draft = storedDraftSchema.safeParse(parsed);
    if (draft.success) return Result.ok(draft.data);
    // A record without a usable key (corrupt, or foreign to this build) holds nothing to lose
    // and must not block setup: it reads as empty and the next draft replaces it.
    return holdsSecretKey(parsed) ? Result.err({ code: "invalid_draft" }) : Result.ok(null);
  }

  private removeStored(): DraftResult<void> {
    try {
      this.storage().removeItem(STORAGE_KEY);
      return Result.ok();
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
  }

  private write(stored: StoredDraft): DraftResult<void> {
    try {
      this.storage().setItem(STORAGE_KEY, JSON.stringify(stored));
      return Result.ok();
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
  }
}

function parseStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Parser errors can contain the stored secret. Do not retain their messages.
    return undefined;
  }
}

function holdsSecretKey(value: unknown): boolean {
  if (!isRecord(value) || typeof value.secretKey !== "string") return false;
  const bytes = decodeBase64Url(value.secretKey);
  const holds = bytes?.byteLength === PUBKY_SECRET_KEY_BYTES;
  bytes?.fill(0);
  return holds;
}

function metadata(stored: StoredDraft): LocalAccountDraft {
  return {
    publicIdentity: { publicKeyZ32: stored.publicKeyZ32 },
    invite: { homeserverPubky: stored.homeserverPubky, signupToken: stored.signupToken },
    step: stored.step,
    ...(stored.registrationStarted ? { registrationStarted: true } : {}),
  };
}
