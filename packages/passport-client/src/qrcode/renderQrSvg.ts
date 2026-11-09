import { qrcodegen } from "./vendor/qrcodegen.js";

type Options = { ecc?: "L" | "M" | "Q" | "H"; border?: number; label?: string };
const CAPACITY = "QR text exceeds capacity.";
const OPTIONS = "QR options must be an object.";

/**
 * Render a QR image with a light quiet zone and no payload-bearing DOM attributes.
 * Unlike the client APIs, this synchronous utility throws built-in TypeError/RangeError
 * for invalid inputs or capacity limits. Messages are constant and errors have no cause.
 * Import is SSR-safe; rendering requires a browser document.
 */
export function renderQrSvg(text: string, options?: Options): SVGSVGElement {
  if (typeof text !== "string") throw new TypeError("QR text must be a string.");
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError(OPTIONS);
  const label = readOption(options, "label");
  if (label !== undefined && typeof label !== "string")
    throw new TypeError("QR label must be a string.");
  if (!text.length) throw new RangeError("QR text must not be empty.");
  if (text.length > 7089) throw new RangeError(CAPACITY);
  if (/\p{Cs}/u.test(text)) throw new RangeError("QR text must be well-formed Unicode.");
  const suppliedEcc = readOption(options, "ecc");
  const ecc = suppliedEcc === undefined ? "M" : suppliedEcc;
  if (ecc !== "L" && ecc !== "M" && ecc !== "Q" && ecc !== "H")
    throw new RangeError("QR ECC must be L, M, Q or H.");
  const suppliedBorder = readOption(options, "border");
  const border = suppliedBorder === undefined ? 4 : suppliedBorder;
  if (!Number.isInteger(border) || border < 0 || border > 16)
    throw new RangeError("QR border must be an integer from 0 to 16.");
  const levels = qrcodegen.QrCode.Ecc;
  let code: qrcodegen.QrCode;
  try {
    code = qrcodegen.QrCode.encodeSegments(
      qrcodegen.QrSegment.makeSegments(text),
      { L: levels.LOW, M: levels.MEDIUM, Q: levels.QUARTILE, H: levels.HIGH }[ecc],
      1,
      40,
      -1,
      false,
    );
  } catch {
    throw new RangeError(CAPACITY);
  }
  let path = "";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.getModule(x, y)) continue;
      const start = x;
      while (x + 1 < code.size && code.getModule(x + 1, y)) x++;
      const length = x - start + 1;
      path += `M${start + border},${y + border}h${length}v1h-${length}z`;
    }
  }
  try {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    const size = String(code.size + border * 2);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label || "QR code to sign in with Pubky Ring or Bitkit");
    // Styled through the CSSOM, which strict style-src policies allow: the code sits in a closed
    // root the element's stylesheet cannot reach, and an inline SVG would leave a line-box gap
    // under the code.
    svg.style.display = "block";
    svg.style.width = "100%";
    svg.style.height = "auto";
    const background = document.createElementNS(namespace, "rect");
    background.setAttribute("width", size);
    background.setAttribute("height", size);
    // Fixed colours: a code scans only dark on light, whatever the page's theme.
    background.setAttribute("fill", "#fff");
    const modules = document.createElementNS(namespace, "path");
    modules.setAttribute("d", path);
    modules.setAttribute("fill", "#0c0b12");
    svg.append(background, modules);
    return svg;
  } catch {
    throw new TypeError("QR rendering requires a browser document.");
  }
}

function readOption<K extends keyof Options>(
  options: Options | undefined,
  key: K,
): Options[K] | undefined {
  try {
    return options?.[key];
  } catch {
    throw new TypeError(OPTIONS);
  }
}
