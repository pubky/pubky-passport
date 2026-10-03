import { expect, test } from "vitest";
import { renderQrSvg } from "../qrcode/renderQrSvg.js";
import { addRingLogo } from "./passportMark.js";

test("the Ring logo sits centred on the code at Passport's 48 of 176 units", () => {
  const svg = addRingLogo(renderQrSvg("pubkyauth://signin?secret=x", { ecc: "H", border: 0 }));
  const size = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  const logo = svg.lastElementChild!;
  expect(logo.tagName).toBe("g");
  const [, x, y, scale] = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/u
    .exec(logo.getAttribute("transform")!)!
    .map(Number);
  const disc = 2 * 19.032 * scale!;
  expect(disc / size).toBeCloseTo(48 / 176, 5);
  expect(x! + disc / 2).toBeCloseTo(size / 2, 5);
  expect(y).toBe(x);
  expect([...logo.children].map((node) => node.getAttribute("fill"))).toEqual([
    "#05050a",
    "#0085ff",
    "#fff",
  ]);
});
