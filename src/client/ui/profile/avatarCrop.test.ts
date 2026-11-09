import { describe, expect, it } from "vitest";

import {
  clampView,
  initialView,
  MAXIMUM_ZOOM,
  panView,
  sourceSquare,
  zoomOf,
  zoomView,
} from "./avatarCrop";

const WIDE = { width: 800, height: 400 };
const VIEWPORT = 200;

describe("avatarCrop", () => {
  it("starts with the picture covering the square, centred", () => {
    const view = initialView(WIDE, VIEWPORT);
    expect(view).toEqual({ scale: 0.5, x: -100, y: 0 });
    expect(sourceSquare(view, VIEWPORT)).toEqual({ x: 200, y: 0, size: 400 });
  });

  it("never uncovers an edge while panning", () => {
    const view = initialView(WIDE, VIEWPORT);
    expect(panView(view, 500, 50, WIDE, VIEWPORT)).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(panView(view, -500, -50, WIDE, VIEWPORT)).toEqual({ scale: 0.5, x: -200, y: 0 });
    expect(clampView({ scale: 0.5, x: 20, y: -20 }, WIDE, VIEWPORT)).toEqual({
      scale: 0.5,
      x: 0,
      y: 0,
    });
  });

  it("zooms around the square's centre, from cover to the maximum", () => {
    const view = initialView(WIDE, VIEWPORT);
    const zoomed = zoomView(view, 2, WIDE, VIEWPORT);
    expect(zoomOf(zoomed, WIDE, VIEWPORT)).toBe(2);
    // The centre of the picture stays under the centre of the square.
    expect(sourceSquare(zoomed, VIEWPORT)).toEqual({ x: 300, y: 100, size: 200 });
    expect(zoomOf(zoomView(view, 99, WIDE, VIEWPORT), WIDE, VIEWPORT)).toBe(MAXIMUM_ZOOM);
    expect(zoomOf(zoomView(zoomed, 0.1, WIDE, VIEWPORT), WIDE, VIEWPORT)).toBe(1);
  });
});
