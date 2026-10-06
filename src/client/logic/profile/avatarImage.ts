import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import { AVATAR_TYPES, isAvatarFile, sniffImageType, type PreparedAvatar } from "./profile";

/** Longest published edge; avatars render at 192 CSS pixels at most. */
export const AVATAR_MAX_DIMENSION = 512;
const EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AvatarResult = ResultType<PreparedAvatar, CodedFailure<"invalid_avatar">>;

/**
 * Re-encodes a chosen avatar before publication. Only the decoded pixels are published, so EXIF
 * (location, device, capture time) and other metadata never reach public storage, and the local
 * file name is replaced by a generic one. Runs before any homeserver session or grant is used.
 */
export async function prepareAvatar(file: File): Promise<AvatarResult> {
  if (!isAvatarFile(file)) return Result.err({ code: "invalid_avatar" });
  let bitmap: ImageBitmap | undefined;
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const sourceType = sniffImageType(header);
    if (!sourceType) return Result.err({ code: "invalid_avatar" });
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext("2d");
    if (!context) return Result.err({ code: "invalid_avatar" });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Photos stay JPEG; everything else keeps transparency. A browser without a WebP encoder
    // returns PNG, so the published type is read from the encoded bytes, not assumed.
    const encoded = await canvas.convertToBlob({
      type: sourceType === "image/jpeg" || sourceType === "image/webp" ? sourceType : "image/png",
      quality: 0.9,
    });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const contentType = sniffImageType(bytes);
    if (!contentType || !AVATAR_TYPES.includes(contentType)) {
      return Result.err({ code: "invalid_avatar" });
    }
    return Result.ok({ bytes, contentType, name: `avatar.${EXTENSIONS[contentType]}` });
  } catch (e) {
    LOGGER.warn("profile.avatar.prepare.failed", {
      code: "invalid_avatar",
      ...safeErrorLogFields(e),
    });
    return Result.err({ code: "invalid_avatar", cause: e });
  } finally {
    bitmap?.close();
  }
}

/** Edge of the avatar copy kept for lists; rows show avatars at 40 CSS pixels. */
export const AVATAR_THUMBNAIL_SIZE = 96;

/**
 * A small square JPEG copy of an avatar, as a `data:` URL, for lists that name identities without
 * reading their profiles again. The centre is cropped to a square and transparency lands on the
 * card colour. Resolves `undefined` wherever the browser cannot decode or encode the image.
 */
export async function avatarThumbnail(avatar: Blob): Promise<string | undefined> {
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function")
      return undefined;
    bitmap = await createImageBitmap(avatar);
    const edge = Math.min(bitmap.width, bitmap.height);
    if (edge <= 0) return undefined;
    const canvas = new OffscreenCanvas(AVATAR_THUMBNAIL_SIZE, AVATAR_THUMBNAIL_SIZE);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#1f1f23";
    context.fillRect(0, 0, AVATAR_THUMBNAIL_SIZE, AVATAR_THUMBNAIL_SIZE);
    context.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      AVATAR_THUMBNAIL_SIZE,
      AVATAR_THUMBNAIL_SIZE,
    );
    const encoded = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    if (sniffImageType(bytes) !== "image/jpeg") return undefined;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch (e) {
    LOGGER.info("profile.avatar.thumbnail.failed", safeErrorLogFields(e));
    return undefined;
  } finally {
    bitmap?.close();
  }
}
