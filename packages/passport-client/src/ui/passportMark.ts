const SVG = "http://www.w3.org/2000/svg";
// The Pubky mark from Passport's pubkyBrandIcon.tsx.
const PATH =
  "M9.55762 8.69727c4.04278.00025 7.32028 3.27253 7.32028 7.30953 0 1.7471-.6147 3.3492-1.6357 4.6045l2.8008 8.5518H1.07129l2.80078-8.5518c-1.02096-1.2553-1.63574-2.8574-1.63574-4.6045.00004-4.0371 3.27833-7.30953 7.32129-7.30953Zm0 3.44233c-2.13897 0-3.87296 1.7318-3.87305 3.8672 0 1.48.83264 2.7659 2.05664 3.4161l.125.0673-2.04004 6.2305h7.46193l-2.04-6.2305.125-.0673c1.224-.6502 2.0566-1.9361 2.0566-3.4161-.0001-2.1352-1.7333-3.8669-3.87208-3.8672ZM9.55957.00293l.00098.00098 2.30665 3.0205 2.9756-1.87109.8183 3.15137 3.4532-.72461-3.1407 5.12304a9.68672 9.68672 0 0 0-6.41305-2.4121h-.00684a9.68682 9.68682 0 0 0-6.41309 2.4121L0 3.58008l3.45312.72461.81836-3.15137 2.97559 1.87109L9.55762 0l.00195.00293Z";
// Line icons, 24 units square, drawn in the text colour: the settings, check and cross controls.
const SLIDERS =
  "M4 7h2.5M11.5 7H20M4 17h8.5M17.5 17H20M9 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 1 1 0-5ZM15 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 1 1 0-5Z";
const CHECK = "M5 12.5l4.5 4.5L19 7.5";
const CROSS = "M6.5 6.5l11 11M17.5 6.5l-11 11";

/** An SVG element with `attributes`; every icon here is built this way, never from markup. */
function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function lineIcon(document: Document, d: string): SVGSVGElement {
  const svg = svgElement(document, "svg", {
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  svg.append(svgElement(document, "path", { d }));
  return svg;
}

export function createPassportMark(document: Document): SVGSVGElement {
  const svg = svgElement(document, "svg", {
    viewBox: "0 0 19.1143 29.1631",
    width: "11",
    height: "16",
    fill: "none",
    "aria-hidden": "true",
    "data-slot": "mark",
  });
  svg.append(svgElement(document, "path", { d: PATH, fill: "currentColor" }));
  return svg;
}

/**
 * Pubky Ring's logo in the middle of a QR code, as Passport draws it: 48 of the code's 176 units,
 * restored by the H error correction the element renders with. Its glyph is the Pubky mark, a blue
 * copy under a white one on a dark disc.
 */
export function addRingLogo(svg: SVGSVGElement): SVGSVGElement {
  const size = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  if (!Number.isFinite(size) || size <= 0) return svg;
  // The logo's own drawing is 38.064 units wide; it is centred on the code at Passport's ratio.
  const scale = (size * (48 / 176)) / 38.064;
  const offset = size / 2 - 19.032 * scale;
  const document = svg.ownerDocument;
  // Crisp edges suit the modules, not the round logo.
  const logo = svgElement(document, "g", {
    transform: `translate(${offset} ${offset}) scale(${scale})`,
    "shape-rendering": "geometricPrecision",
  });
  logo.append(
    svgElement(document, "circle", { cx: "19.032", cy: "19.032", r: "19.032", fill: "#05050a" }),
    svgElement(document, "path", {
      d: PATH,
      fill: "#0085ff",
      transform: "translate(12.0146 7.3429) scale(.752)",
    }),
    svgElement(document, "path", {
      d: PATH,
      fill: "#fff",
      transform: "translate(11.8857 7.0277) scale(.766)",
    }),
  );
  svg.append(logo);
  return svg;
}

/** Sliders: the settings control on the button. */
export function createSettingsIcon(document: Document): SVGSVGElement {
  return lineIcon(document, SLIDERS);
}

/** A check mark: the control that uses the typed Passport. */
export function createCheckIcon(document: Document): SVGSVGElement {
  return lineIcon(document, CHECK);
}

/** A cross: cancels a sign-in in progress, or resets a chosen Passport. */
export function createCrossIcon(document: Document): SVGSVGElement {
  return lineIcon(document, CROSS);
}
