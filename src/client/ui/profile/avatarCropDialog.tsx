"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
  type WheelEvent,
} from "react";

import { CheckIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import {
  type CropView,
  type ImageSize,
  initialView,
  MAXIMUM_ZOOM,
  panView,
  sourceSquare,
  zoomOf,
  zoomView,
} from "./avatarCrop";

/** The crop's viewport, in CSS pixels; it fits the 327px dialog of a 375px phone. */
const VIEWPORT = 272;
/** The cropped avatar's side in pixels: what the profile's image re-encode works from. */
const OUTPUT = 512;
/** How far one arrow key press moves the image. */
const KEY_STEP = 16;

/**
 * Crops a chosen picture to the square the avatar shows, as pubky.app does before an upload:
 * the picture under a round guide, dragged to place it (or moved with the arrow keys) and zoomed
 * with the slider, the wheel or + and -. Use photo hands back a 512px PNG of the square, which
 * the profile then checks and re-encodes like any chosen file; Cancel keeps the avatar as it was.
 * An animated GIF keeps its first frame.
 */
export function AvatarCropDialog({
  file,
  onCancel,
  onCropped,
}: {
  /** The picture to crop; the dialog is open while there is one. */
  file: File | undefined;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const titleId = useId();
  const zoomId = useId();
  const [source, setSource] = useState<{ url: string; image: HTMLImageElement }>();
  const [view, setView] = useState<CropView>();
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number }>(undefined);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (!active) return;
      setSource({ url, image });
      setView(initialView(sizeOf(image), VIEWPORT));
    };
    image.onerror = () => {
      if (active) setFailed(true);
    };
    image.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
      setSource(undefined);
      setView(undefined);
      setFailed(false);
      setWorking(false);
    };
  }, [file]);

  const size = source ? sizeOf(source.image) : undefined;
  const zoom = size && view ? zoomOf(view, size, VIEWPORT) : 1;
  const zoomTo = (next: number) => {
    if (size && view) setView(zoomView(view, next, size, VIEWPORT));
  };
  const panBy = (dx: number, dy: number) => {
    if (size && view) setView(panView(view, dx, dy, size, VIEWPORT));
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const last = drag.current;
    if (!last || last.id !== event.pointerId) return;
    drag.current = { id: last.id, x: event.clientX, y: event.clientY };
    panBy(event.clientX - last.x, event.clientY - last.y);
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = undefined;
  }
  function onWheel(event: WheelEvent<HTMLDivElement>) {
    zoomTo(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const move = moves[event.key];
    if (move) panBy(move[0], move[1]);
    else if (event.key === "+" || event.key === "=") zoomTo(zoom * 1.1);
    else if (event.key === "-") zoomTo(zoom / 1.1);
    else return;
    event.preventDefault();
  }

  async function crop() {
    if (!source || !view || !file) return;
    setWorking(true);
    const square = sourceSquare(view, VIEWPORT);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) {
      setFailed(true);
      setWorking(false);
      return;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source.image,
      square.x,
      square.y,
      square.size,
      square.size,
      0,
      0,
      OUTPUT,
      OUTPUT,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    setWorking(false);
    if (!blob) {
      setFailed(true);
      return;
    }
    onCropped(new File([blob], "avatar.png", { type: "image/png" }));
  }

  return (
    <Dialog
      aria-labelledby={titleId}
      className="m-auto w-[min(100%-2rem,375px)] rounded-xl border bg-popover p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75"
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open={file !== undefined}
    >
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-bold leading-7" id={titleId}>
          Crop your avatar
        </h2>
        {failed ? (
          <p className="text-sm leading-5 text-destructive-text" role="alert">
            This image can’t be opened. Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.
          </p>
        ) : (
          <>
            <div
              aria-describedby={`${zoomId}-help`}
              aria-label="Avatar crop: drag or use the arrow keys to move, + and - to zoom"
              className="relative mx-auto touch-none overflow-hidden rounded-md bg-black outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              onKeyDown={onKeyDown}
              onPointerCancel={onPointerUp}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
              role="group"
              style={{ height: VIEWPORT, width: VIEWPORT, cursor: "grab" }}
              tabIndex={0}
            >
              {source && view && size ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob, drawn as is
                <img
                  alt=""
                  className="pointer-events-none absolute left-0 top-0 max-w-none"
                  draggable={false}
                  src={source.url}
                  style={{
                    height: size.height * view.scale,
                    transform: `translate(${view.x}px, ${view.y}px)`,
                    width: size.width * view.scale,
                  }}
                />
              ) : null}
              {/* The round guide: everything outside the circle is dimmed. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(5,5,10,0.6)] ring-2 ring-white/80"
              />
            </div>
            <p className="sr-only" id={`${zoomId}-help`}>
              The square is your avatar; pubky.app shows it in a circle.
            </p>
            <div className="flex flex-col gap-2">
              <label
                className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground"
                htmlFor={zoomId}
              >
                Zoom
              </label>
              <input
                className="w-full accent-[var(--brand)]"
                id={zoomId}
                max={MAXIMUM_ZOOM}
                min={1}
                onChange={(event) => zoomTo(Number(event.target.value))}
                step={0.01}
                type="range"
                value={zoom}
              />
            </div>
          </>
        )}
        <div className="flex flex-col gap-3">
          <Button className="w-full" onClick={onCancel} size="lg" variant="outline">
            Cancel
          </Button>
          <Button
            className="w-full"
            disabled={failed || !source}
            loading={working}
            onClick={() => void crop()}
            size="lg"
          >
            <CheckIcon />
            Use photo
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function sizeOf(image: HTMLImageElement): ImageSize {
  return { width: image.naturalWidth, height: image.naturalHeight };
}
