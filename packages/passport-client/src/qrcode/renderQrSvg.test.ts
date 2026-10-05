import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_MESSAGES } from "../errors/defaultMessages.js";
import { renderQrSvg } from "./renderQrSvg.js";
import vectors from "../../test-vectors/qrcode.json" with { type: "json" };

const PRIVATE = ["private", "qr", "canary"].join("-");
const payload = (bytes: number) => "pubkyauth://" + "a".repeat(bytes - "pubkyauth://".length);
afterEach(() => {
  vi.restoreAllMocks();
});

/** Rasterize the SVG's integer horizontal runs, then inspect its visible QR modules. */
function modules(svg: SVGSVGElement, border = 4) {
  const [left, top, width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  expect(left).toBe(0);
  expect(top).toBe(0);
  expect(height).toBe(width);
  const size = width! - 2 * border;
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const path = svg.querySelector("path")!.getAttribute("d")!;
  const runs = [...path.matchAll(/M(\d+),(\d+)h(\d+)v1h-(\d+)z/gu)];
  expect(runs.map((m) => m[0]).join("")).toBe(path);
  for (const [, rawX, rawY, rawLength, rawBack] of runs) {
    const x = Number(rawX) - border,
      y = Number(rawY) - border,
      length = Number(rawLength);
    expect(rawBack).toBe(rawLength);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + length).toBeLessThanOrEqual(size);
    expect(y).toBeLessThan(size);
    for (let i = x; i < x + length; i++) grid[y]![i] = true;
  }
  return { size, grid };
}
function formatData(grid: boolean[][]) {
  // Positions of the first format-information copy, per the pinned upstream drawFormatBits.
  const positions = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  const bits = positions.reduce((bits, [x, y], i) => bits | (Number(grid[y!]![x!]) << i), 0);
  return (bits ^ 0x5412) >>> 10;
}

test.each(vectors)("renders the independent $name grid, version and mask", (vector) => {
  expect(new TextEncoder().encode(vector.text).length).toBe(vector.bytes);
  const svg = renderQrSvg(vector.text);
  const { size, grid } = modules(svg);
  expect(size).toBe(vector.size);
  expect((size - 17) / 4).toBe(vector.version);
  const data = formatData(grid);
  expect(data & 7).toBe(vector.mask);
  expect(data >>> 3).toBe(0); // M, without boosting to a stronger ECC.
  const matrix = grid.map((row) => row.map((bit) => (bit ? "1" : "0")).join("")).join("\n");
  expect(createHash("sha256").update(matrix).digest("hex")).toBe(vector.sha256);
});

test("creates SVG nodes only, with one path, light quiet zone, safe label and no payload attributes", () => {
  const markup = `<script>${PRIVATE}</script>`;
  const label = `<img onerror="${PRIVATE}">`;
  const html = vi.spyOn(Element.prototype, "innerHTML", "set").mockImplementation(() => {
    throw new Error("Unexpected HTML setter");
  });
  const create = vi.spyOn(document, "createElementNS");
  const ordinary = vi.spyOn(document, "createElement");
  const svg = renderQrSvg(markup, { label });
  expect(ordinary).not.toHaveBeenCalled();
  expect(create.mock.calls.map(([namespace, name]) => [namespace, name])).toEqual([
    ["http://www.w3.org/2000/svg", "svg"],
    ["http://www.w3.org/2000/svg", "rect"],
    ["http://www.w3.org/2000/svg", "path"],
  ]);
  expect(html).not.toHaveBeenCalled();
  expect(svg.querySelectorAll("path")).toHaveLength(1);
  expect(svg.querySelector("script,img,a,style,image,foreignObject")).toBeNull();
  expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
  // A block box filling its tile: an inline SVG would leave a line-box gap under the code.
  expect([svg.style.display, svg.style.width, svg.style.height]).toEqual(["block", "100%", "auto"]);
  expect(svg.getAttribute("role")).toBe("img");
  expect(svg.getAttribute("aria-label")).toBe(label);
  expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#fff");
  expect(svg.querySelector("path")!.getAttribute("fill")).toBe("#0c0b12");
  for (const node of [svg, ...svg.querySelectorAll("*")])
    for (const attribute of node.attributes)
      if (attribute.name !== "aria-label") expect(attribute.value).not.toContain(PRIVATE);
});

test.each([undefined, "", "Mit Pubky Ring anmelden"])(
  "uses a nonempty accessible label (%s)",
  (label) => {
    const svg = renderQrSvg(PRIVATE, label === undefined ? undefined : { label });
    expect(svg.getAttribute("aria-label")).toBe(label || DEFAULT_MESSAGES["ring.qr-label"]);
  },
);

test.each([0, 4, 16])("uses the requested quiet-zone border %s", (border) => {
  const svg = renderQrSvg("Hello, Passport", { border });
  const rendered = modules(svg, border);
  expect(rendered.size).toBe(25);
  expect(rendered.grid).toEqual(modules(renderQrSvg("Hello, Passport")).grid);
});

test.each([
  ["L", 1],
  ["M", 0],
  ["Q", 3],
  ["H", 2],
] as const)("encodes exactly ECC %s with no boost", (ecc, format) => {
  expect(formatData(modules(renderQrSvg("a", { ecc })).grid) >>> 3).toBe(format);
});

const invalid: {
  name: string;
  text: unknown;
  options?: unknown;
  error: typeof TypeError | typeof RangeError;
  message: string;
}[] = [
  {
    name: "undefined text",
    text: undefined,
    error: TypeError,
    message: "QR text must be a string.",
  },
  { name: "null text", text: null, error: TypeError, message: "QR text must be a string." },
  {
    name: "null options",
    text: PRIVATE,
    options: null,
    error: TypeError,
    message: "QR options must be an object.",
  },
  {
    name: "primitive options",
    text: PRIVATE,
    options: false,
    error: TypeError,
    message: "QR options must be an object.",
  },
  {
    name: "non-string label",
    text: PRIVATE,
    options: { label: 1 },
    error: TypeError,
    message: "QR label must be a string.",
  },
  { name: "empty text", text: "", error: RangeError, message: "QR text must not be empty." },
  {
    name: "high surrogate",
    text: PRIVATE + "\uD800",
    error: RangeError,
    message: "QR text must be well-formed Unicode.",
  },
  {
    name: "low surrogate",
    text: PRIVATE + "\uDC00",
    error: RangeError,
    message: "QR text must be well-formed Unicode.",
  },
  {
    name: "7090 digits",
    text: "1".repeat(7090),
    error: RangeError,
    message: "QR text exceeds capacity.",
  },
  {
    name: "lowercase ECC",
    text: PRIVATE,
    options: { ecc: "m" },
    error: RangeError,
    message: "QR ECC must be L, M, Q or H.",
  },
  ...[-1, 1.5, NaN, "4", 17, null].map((border) => ({
    name: `border ${String(border)}`,
    text: PRIVATE,
    options: { border },
    error: RangeError,
    message: "QR border must be an integer from 0 to 16.",
  })),
  {
    name: "M capacity",
    text: payload(2332),
    error: RangeError,
    message: "QR text exceeds capacity.",
  },
  {
    name: "H capacity",
    text: payload(1274),
    options: { ecc: "H" },
    error: RangeError,
    message: "QR text exceeds capacity.",
  },
];
test.each(invalid)(
  "rejects $name with a constant safe built-in error",
  ({ text, options, error, message }) => {
    let caught: unknown;
    try {
      renderQrSvg(text as never, options as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(error);
    const failure = caught as Error;
    expect(failure.constructor).toBe(error);
    expect(failure.message).toBe(message);
    expect(Object.hasOwn(failure, "cause")).toBe(false);
    for (const key of Object.getOwnPropertyNames(failure))
      expect(String(Reflect.get(failure, key))).not.toContain(PRIVATE);
  },
);

test.each([
  [2331, "M"],
  [1273, "H"],
] as const)("fits the %s-byte boundary at ECC %s", (bytes, ecc) => {
  expect(new TextEncoder().encode(payload(bytes))).toHaveLength(bytes);
  expect(modules(renderQrSvg(payload(bytes), { ecc })).size).toBe(177);
});
test("accepts valid surrogate pairs", () => {
  expect(renderQrSvg("😀").getAttribute("role")).toBe("img");
});

test.each([
  [undefined, { label: 3 }, "QR text must be a string."],
  ["", null, "QR options must be an object."],
  ["", { label: 3 }, "QR label must be a string."],
  ["", { ecc: "bad" }, "QR text must not be empty."],
  ["\uD800".repeat(7090), { ecc: "bad" }, "QR text exceeds capacity."],
  ["\uD800", { ecc: "bad" }, "QR text must be well-formed Unicode."],
  [PRIVATE, { ecc: "bad", border: -1 }, "QR ECC must be L, M, Q or H."],
])("validates in the specified order %#", (text, options, message) => {
  expect(() => renderQrSvg(text as never, options as never)).toThrow(message);
});

test.each(["label", "ecc", "border"] as const)("contains a throwing %s option getter", (key) => {
  const options = Object.defineProperty({}, key, {
    get() {
      throw new Error(PRIVATE);
    },
  });
  let error: Error | undefined;
  try {
    renderQrSvg(PRIVATE, options);
  } catch (e) {
    error = e as Error;
  }
  expect(error?.constructor).toBe(TypeError);
  expect(error?.message).toBe("QR options must be an object.");
  expect(Object.hasOwn(error!, "cause")).toBe(false);
  expect(error?.stack).not.toContain(PRIVATE);
});

test("rejects oversized numeric input before reading encoder options or creating DOM", () => {
  const ecc = vi.fn(() => "M" as const);
  const create = vi.spyOn(document, "createElementNS");
  expect(() =>
    renderQrSvg("1".repeat(7090), {
      get ecc() {
        return ecc();
      },
    }),
  ).toThrow("QR text exceeds capacity.");
  expect(ecc).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test("contains DOM failures without leaking the native exception", () => {
  vi.spyOn(document, "createElementNS").mockImplementationOnce(() => {
    throw new Error(PRIVATE);
  });
  let error: Error | undefined;
  try {
    renderQrSvg(PRIVATE);
  } catch (e) {
    error = e as Error;
  }
  expect(error?.constructor).toBe(TypeError);
  expect(error?.message).toBe("QR rendering requires a browser document.");
  expect(Object.hasOwn(error!, "cause")).toBe(false);
  expect(error?.stack).not.toContain(PRIVATE);
});
