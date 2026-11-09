/**
 * The geometry of the avatar crop: a square viewport over an image that always covers it. The
 * image is drawn at `scale` (CSS pixels per image pixel) with its top-left corner at `x`, `y`
 * from the viewport's top-left, so both offsets are zero or negative. The circle shown over the
 * viewport is only a guide: the crop itself is the whole square, as on pubky.app.
 */
export type CropView = { x: number; y: number; scale: number };

export type ImageSize = { width: number; height: number };

/** How far the crop may zoom in past the scale that just covers the viewport. */
export const MAXIMUM_ZOOM = 4;

/** The scale at which the image's shorter side just fills the viewport. */
export function coverScale(image: ImageSize, viewport: number): number {
  return viewport / Math.min(image.width, image.height);
}

/** Keeps the image over the whole viewport: no offset may uncover an edge. */
export function clampView(view: CropView, image: ImageSize, viewport: number): CropView {
  const minimumX = Math.min(0, viewport - image.width * view.scale);
  const minimumY = Math.min(0, viewport - image.height * view.scale);
  return {
    scale: view.scale,
    x: Math.min(0, Math.max(minimumX, view.x)),
    y: Math.min(0, Math.max(minimumY, view.y)),
  };
}

/** The image covering the viewport, centred: where a new crop starts. */
export function initialView(image: ImageSize, viewport: number): CropView {
  const scale = coverScale(image, viewport);
  return {
    scale,
    x: (viewport - image.width * scale) / 2,
    y: (viewport - image.height * scale) / 2,
  };
}

/** The view at `zoom` (1 is cover), keeping the point under the viewport's centre in place. */
export function zoomView(
  view: CropView,
  zoom: number,
  image: ImageSize,
  viewport: number,
): CropView {
  const scale = coverScale(image, viewport) * Math.min(MAXIMUM_ZOOM, Math.max(1, zoom));
  const centreX = (viewport / 2 - view.x) / view.scale;
  const centreY = (viewport / 2 - view.y) / view.scale;
  return clampView(
    { scale, x: viewport / 2 - centreX * scale, y: viewport / 2 - centreY * scale },
    image,
    viewport,
  );
}

/** The view moved by `dx`, `dy` CSS pixels, still covering the viewport. */
export function panView(
  view: CropView,
  dx: number,
  dy: number,
  image: ImageSize,
  viewport: number,
): CropView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, viewport);
}

/** The zoom of `view` relative to the cover scale (1 to {@link MAXIMUM_ZOOM}). */
export function zoomOf(view: CropView, image: ImageSize, viewport: number): number {
  return view.scale / coverScale(image, viewport);
}

/** The square of the image the viewport shows, in image pixels: what the crop keeps. */
export function sourceSquare(
  view: CropView,
  viewport: number,
): { x: number; y: number; size: number } {
  // `0 - x`, not `-x`: an offset of zero gives zero, never -0.
  return {
    x: (0 - view.x) / view.scale,
    y: (0 - view.y) / view.scale,
    size: viewport / view.scale,
  };
}
