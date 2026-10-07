/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarCropDialog } from "./avatarCropDialog";

const PICTURE = new File(["jpeg"], "holiday.jpg", { type: "image/jpeg" });
const drawImage = vi.fn();

/**
 * jsdom decodes no pictures: the dialog's picture loads as an 800×400 image, or fails to, a
 * moment after its source is set.
 */
function stubPicture(outcome: "load" | "error" = "load") {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 800;
      naturalHeight = 400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (outcome === "load" ? this.onload : this.onerror)?.());
      }
    },
  );
}

/** jsdom draws no canvas: its 2D context records the drawing, and it encodes `blob`. */
function stubCanvas(blob: Blob | null = new Blob(["cropped"], { type: "image/png" })) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(blob));
}

function mount(file: File | undefined) {
  const onCancel = vi.fn();
  const onCropped = vi.fn<(cropped: File) => void>();
  const view = render(<AvatarCropDialog file={file} onCancel={onCancel} onCropped={onCropped} />);
  return { ...view, onCancel, onCropped };
}

/** The picture once it loaded, and where it is drawn in the 272px square. */
async function loadedPicture() {
  const dialog = screen.getByRole("dialog", { name: "Crop your avatar" });
  await waitFor(() => expect(dialog.querySelector("img")).not.toBeNull());
  return dialog.querySelector("img")!;
}

function placement(picture: HTMLImageElement) {
  const [, x, y] = /translate\((\S+)px, (\S+)px\)/u.exec(picture.style.transform)!;
  return {
    x: Number(x),
    y: Number(y),
    width: parseFloat(picture.style.width),
    height: parseFloat(picture.style.height),
  };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:picture");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AvatarCropDialog", () => {
  it("is closed without a picture to crop", () => {
    stubPicture();
    mount(undefined);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the picture, covering the square and centred, with Use photo once it loaded", async () => {
    stubPicture();
    mount(PICTURE);

    const dialog = screen.getByRole("dialog", { name: "Crop your avatar" });
    const use = within(dialog).getByRole("button", { name: "Use photo" });
    expect(use).toBeDisabled();
    const picture = await loadedPicture();
    expect(picture).toHaveAttribute("src", "blob:picture");
    expect(placement(picture)).toEqual({ x: -136, y: 0, width: 544, height: 272 });
    expect(within(dialog).getByRole("slider", { name: "Zoom" })).toHaveValue("1");
    expect(use).toBeEnabled();
    expect(
      within(dialog).getByRole("group", {
        name: "Avatar crop: drag or use the arrow keys to move, + and - to zoom",
      }),
    ).toHaveAccessibleDescription("The square is your avatar; pubky.app shows it in a circle.");
  });

  it("moves the picture with the arrow keys, never past its edges", async () => {
    stubPicture();
    mount(PICTURE);
    const picture = await loadedPicture();
    const crop = screen.getByRole("group", { name: /^Avatar crop/u });
    crop.focus();
    const user = userEvent.setup();

    await user.keyboard("{ArrowLeft}");
    expect(placement(picture).x).toBeCloseTo(-120);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(placement(picture).x).toBeCloseTo(-152);
    // The picture's height just fills the square, so it cannot move up or down.
    await user.keyboard("{ArrowUp}{ArrowDown}");
    expect(placement(picture).y).toBeCloseTo(0);
    // Its left edge stops at the square's.
    for (let press = 0; press < 20; press++) await user.keyboard("{ArrowLeft}");
    expect(placement(picture).x).toBeCloseTo(0);
  });

  it("zooms about the centre with + and -, and with the wheel, between the cover and 4×", async () => {
    stubPicture();
    mount(PICTURE);
    const picture = await loadedPicture();
    const crop = screen.getByRole("group", { name: /^Avatar crop/u });
    const zoom = screen.getByRole<HTMLInputElement>("slider", { name: "Zoom" });
    crop.focus();
    const user = userEvent.setup();

    await user.keyboard("+");
    expect(Number(zoom.value)).toBeCloseTo(1.1);
    expect(placement(picture).width).toBeCloseTo(544 * 1.1);
    // Zoomed in, it can move up and down too, until its bottom edge meets the square's.
    expect(placement(picture).y).toBeCloseTo(-13.6);
    await user.keyboard("{ArrowDown}");
    expect(placement(picture).y).toBeCloseTo(272 - 272 * 1.1);
    await user.keyboard("-");
    expect(Number(zoom.value)).toBeCloseTo(1);
    // Never smaller than the square it must cover.
    await user.keyboard("--");
    expect(placement(picture)).toMatchObject({ width: 544, height: 272 });

    fireEvent.wheel(crop, { deltaY: -100 });
    expect(Number(zoom.value)).toBeCloseTo(1.1);
    fireEvent.wheel(crop, { deltaY: 100 });
    expect(Number(zoom.value)).toBeCloseTo(1);
  });

  it("zooms with the slider, keeping the centre in place", async () => {
    stubPicture();
    mount(PICTURE);
    const picture = await loadedPicture();
    const zoom = screen.getByRole("slider", { name: "Zoom" });
    expect(zoom).toHaveAttribute("min", "1");
    expect(zoom).toHaveAttribute("max", "4");

    fireEvent.change(zoom, { target: { value: "2" } });
    const zoomed = placement(picture);
    expect(zoomed.width).toBeCloseTo(1088);
    expect(zoomed.height).toBeCloseTo(544);
    expect(zoomed.x).toBeCloseTo(-408);
    expect(zoomed.y).toBeCloseTo(-136);
    expect(zoom).toHaveValue("2");
  });

  it("hands back a 512px PNG of the square in view", async () => {
    stubPicture();
    stubCanvas();
    const { onCropped, onCancel } = mount(PICTURE);
    await loadedPicture();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });

    await userEvent.setup().click(screen.getByRole("button", { name: "Use photo" }));

    // The middle 200px of the 800×400 picture, zoomed in twice.
    expect(drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ naturalWidth: 800 }),
      expect.closeTo(300),
      expect.closeTo(100),
      expect.closeTo(200),
      expect.closeTo(200),
      0,
      0,
      512,
      512,
    );
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
    );
    expect(onCropped).toHaveBeenCalledOnce();
    const cropped = onCropped.mock.calls[0]![0];
    expect(cropped).toBeInstanceOf(File);
    expect(cropped).toMatchObject({ name: "avatar.png", type: "image/png" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels with Cancel or Escape, cropping nothing", async () => {
    stubPicture();
    stubCanvas();
    const { onCancel, onCropped } = mount(PICTURE);
    await loadedPicture();

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent(
      screen.getByRole("dialog", { name: "Crop your avatar" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onCropped).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("says a picture that cannot be opened is refused, and offers only Cancel", async () => {
    stubPicture("error");
    const { onCancel } = mount(PICTURE);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This image can’t be opened. Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
    );
    expect(screen.queryByRole("slider", { name: "Zoom" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use photo" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("says so when the crop cannot be drawn", async () => {
    stubPicture();
    stubCanvas(null);
    const { onCropped } = mount(PICTURE);
    await loadedPicture();

    await userEvent.setup().click(screen.getByRole("button", { name: "Use photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This image can’t be opened.");
    expect(screen.getByRole("button", { name: "Use photo" })).toBeDisabled();
    expect(onCropped).not.toHaveBeenCalled();
  });

  it("starts afresh on the next picture", async () => {
    stubPicture();
    const { rerender, onCancel, onCropped } = mount(PICTURE);
    const picture = await loadedPicture();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "3" } });
    expect(placement(picture).width).toBeCloseTo(544 * 3);

    rerender(<AvatarCropDialog file={undefined} onCancel={onCancel} onCropped={onCropped} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture");

    const next = new File(["png"], "next.png", { type: "image/png" });
    rerender(<AvatarCropDialog file={next} onCancel={onCancel} onCropped={onCropped} />);
    expect(placement(await loadedPicture())).toEqual({ x: -136, y: 0, width: 544, height: 272 });
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveValue("1");
  });
});
