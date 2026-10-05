import { afterEach, describe, expect, it, vi } from "vitest";
import { expectResultOk } from "@test-utils/resultAssertions";
import {
  AVATAR_MAX_DIMENSION,
  AVATAR_THUMBNAIL_SIZE,
  avatarThumbnail,
  prepareAvatar,
} from "./avatarImage";

const JPEG_START = [0xff, 0xd8];
/** An APP1 segment carrying EXIF with a GPS IFD marker. */
const EXIF = [0xff, 0xe1, 0x00, 0x16, ...new TextEncoder().encode("Exif\0\0GPSLatitude"), 0, 0];
const ENCODED_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]);
const ENCODED_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function stubCanvas(
  width: number,
  height: number,
  output: (type: string) => Uint8Array<ArrayBuffer>,
) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvases: { width: number; height: number; type?: string }[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      readonly record: { width: number; height: number; type?: string };
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        this.record = { width, height };
        canvases.push(this.record);
      }
      getContext() {
        return { drawImage, fillRect: vi.fn(), fillStyle: "" };
      }
      async convertToBlob({ type }: { type: string }) {
        this.record.type = type;
        return new Blob([output(type)]);
      }
    },
  );
  return { close, drawImage, canvases };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("avatar preparation", () => {
  it("publishes re-encoded pixels without EXIF metadata or the local file name", async () => {
    const { close, canvases } = stubCanvas(4032, 3024, () => ENCODED_JPEG);
    const photo = new File(
      [new Uint8Array([...JPEG_START, ...EXIF, 0xff, 0xd9])],
      "jane-doe-passport-scan.jpg",
      { type: "image/jpeg" },
    );
    const avatar = expectResultOk(await prepareAvatar(photo));
    expect(avatar).toEqual({ bytes: ENCODED_JPEG, contentType: "image/jpeg", name: "avatar.jpg" });
    expect(new TextDecoder().decode(avatar.bytes)).not.toContain("Exif");
    // The longest edge is bounded and the aspect ratio kept.
    expect(canvases).toEqual([{ width: AVATAR_MAX_DIMENSION, height: 384, type: "image/jpeg" }]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("identifies the source by its bytes, not its extension, and keeps transparency", async () => {
    const { canvases } = stubCanvas(64, 64, () => ENCODED_PNG);
    const mislabelled = new File([ENCODED_PNG], "avatar.jpg", { type: "image/jpeg" });
    expect(expectResultOk(await prepareAvatar(mislabelled))).toMatchObject({
      contentType: "image/png",
      name: "avatar.png",
    });
    expect(canvases[0]).toEqual({ width: 64, height: 64, type: "image/png" });
  });

  it("uses the format the browser actually encoded when WebP output is unsupported", async () => {
    stubCanvas(64, 64, () => ENCODED_PNG);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xc3, 0xa9, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(
      expectResultOk(await prepareAvatar(new File([webp], "a.webp", { type: "image/webp" }))),
    ).toMatchObject({ contentType: "image/png", name: "avatar.png" });
  });

  it("rejects unsupported, oversized and undecodable files", async () => {
    const { close } = stubCanvas(64, 64, () => ENCODED_PNG);
    expect(
      await prepareAvatar(new File(["<svg/>"], "avatar.png", { type: "image/png" })),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(
      await prepareAvatar(new File([ENCODED_PNG], "avatar.heic", { type: "image/heic" })),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(
      await prepareAvatar(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }),
      ),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));
    expect(
      await prepareAvatar(new File([ENCODED_PNG], "broken.png", { type: "image/png" })),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(close).not.toHaveBeenCalled();
  });

  it("rejects an encoder result that is not a supported image", async () => {
    const { close } = stubCanvas(64, 64, () => new TextEncoder().encode("not an image"));
    expect(
      await prepareAvatar(new File([ENCODED_PNG], "avatar.png", { type: "image/png" })),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("avatar thumbnails for lists", () => {
  it("keeps a small square JPEG of the centre as a data URL", async () => {
    const { close, drawImage, canvases } = stubCanvas(400, 200, () => ENCODED_JPEG);

    const thumbnail = await avatarThumbnail(new Blob([ENCODED_PNG], { type: "image/png" }));

    expect(thumbnail).toBe(`data:image/jpeg;base64,${btoa(String.fromCharCode(...ENCODED_JPEG))}`);
    expect(canvases).toEqual([
      { width: AVATAR_THUMBNAIL_SIZE, height: AVATAR_THUMBNAIL_SIZE, type: "image/jpeg" },
    ]);
    // The centre 200px square of the 400x200 image.
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([
      100,
      0,
      200,
      200,
      0,
      0,
      AVATAR_THUMBNAIL_SIZE,
      AVATAR_THUMBNAIL_SIZE,
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps none where the browser cannot decode or encode the image", async () => {
    expect(await avatarThumbnail(new Blob([ENCODED_PNG]))).toBeUndefined();
    stubCanvas(10, 10, () => ENCODED_PNG);
    expect(await avatarThumbnail(new Blob([ENCODED_PNG]))).toBeUndefined();
  });
});
