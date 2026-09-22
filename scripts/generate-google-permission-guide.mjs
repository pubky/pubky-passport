// Regenerate the consent guide with: node scripts/generate-google-permission-guide.mjs
// Requires ImageMagick (`magick`). Original illustration based on Google's consent layout;
// no account details or screenshots are embedded in the assets.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../public/illustrations/", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "passport-consent-frames-"));
const frames = [];

function checkbox(x, y, checked, partial = false) {
  return `<rect x="${x}" y="${y}" width="18" height="18" rx="1" fill="${checked || partial ? "#a8c7fa" : "none"}" stroke="${checked || partial ? "#a8c7fa" : "#c4c7c5"}" stroke-width="1.8"/>
    ${checked ? `<path d="M${x + 4} ${y + 9}l3.5 3.5 6.5-7" fill="none" stroke="#062e6f" stroke-width="2"/>` : ""}
    ${partial ? `<path d="M${x + 4} ${y + 9}h10" stroke="#062e6f" stroke-width="2"/>` : ""}`;
}

function driveIcon(y) {
  return `<g transform="translate(25 ${y}) scale(.88)">
    <path d="M9 1h8l-9 16H0z" fill="#0f9d58"/>
    <path d="M17 1l10 16h-8L9 1z" fill="#fbbc04"/>
    <path d="M0 17h27l-4 7H4z" fill="#4285f4"/>
  </g>`;
}

function illustration({ first = false, second = false, cursor, click = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="776" viewBox="0 0 480 388">
    <rect width="480" height="388" fill="#0e0e0e"/>
    <g font-family="Arial, sans-serif" font-size="15" fill="#e3e3e3">
      <text x="26" y="36" font-size="18">Select what <tspan fill="#a8c7fa">Pubky Passport</tspan></text>
      <text x="26" y="60" font-size="18">can access</text>
      ${checkbox(29, 83, first && second, first && !second)}
      <text x="63" y="97" font-size="14">Select all</text>
      <path d="M26 117h428M26 215h428M26 313h428" stroke="#444746"/>
      ${driveIcon(138)}
      <text x="64" y="151">See, create, and delete its own</text>
      <text x="64" y="173">configuration data in your</text>
      <text x="64" y="195">Google Drive. <tspan fill="#a8c7fa">See details</tspan></text>
      ${checkbox(428, 138, first)}
      ${driveIcon(236)}
      <text x="64" y="249">See, edit, create, and delete only the</text>
      <text x="64" y="271">specific Google Drive files that you</text>
      <text x="64" y="293">use with this app. <tspan fill="#a8c7fa">See details</tspan></text>
      ${checkbox(428, 236, second)}
      <rect x="26" y="333" width="200" height="38" rx="19" fill="none" stroke="#8e918f"/>
      <rect x="254" y="333" width="200" height="38" rx="19" fill="${click && cursor?.[1] === 352 ? "#25344b" : "none"}" stroke="#8e918f"/>
      <text x="126" y="357" fill="#a8c7fa" text-anchor="middle" font-size="14">Cancel</text>
      <text x="354" y="357" fill="#a8c7fa" text-anchor="middle" font-size="14">Continue</text>
    </g>
    ${cursor && click ? `<circle cx="${cursor[0]}" cy="${cursor[1]}" r="17" fill="#a8c7fa" fill-opacity=".14" stroke="#a8c7fa" stroke-opacity=".6" stroke-width="2"/>` : ""}
    ${cursor ? `<path transform="translate(${cursor[0]} ${cursor[1]})" d="M0 0v23l6-5 5 11 5-2-5-11h9z" fill="white" stroke="#161616" stroke-width="1.5" stroke-linejoin="round"/>` : ""}
  </svg>`;
}

function convert(args, input) {
  const source = join(temporary, "frame.svg");
  if (input) writeFileSync(source, input);
  const result = spawnSync(
    "magick",
    args.map((arg) => (arg === "svg:-" ? source : arg)),
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
}

function frame(state, delay = 7) {
  const path = join(temporary, `${frames.length}.png`);
  convert(["svg:-", path], illustration(state));
  frames.push("-delay", String(delay), path);
}

function move(from, to, state) {
  for (let index = 1; index <= 10; index++) {
    const t = index / 10;
    const eased = t * t * (3 - 2 * t);
    frame({
      ...state,
      cursor: from.map((coordinate, axis) => coordinate + (to[axis] - coordinate) * eased),
    });
  }
}

try {
  frame({}, 60);
  move([95, 68], [38, 92], {});
  frame({ first: true, second: true, cursor: [38, 92], click: true }, 16);
  frame({ first: true, second: true, cursor: [38, 92] }, 55);
  move([38, 92], [356, 352], { first: true, second: true });
  frame({ first: true, second: true, cursor: [356, 352], click: true }, 18);
  frame({ first: true, second: true, cursor: [356, 352] }, 120);
  convert([
    ...frames,
    "-loop",
    "0",
    "-layers",
    "Optimize",
    join(output, "google-drive-permissions.gif"),
  ]);
  convert(
    ["svg:-", join(output, "google-drive-permissions-still.png")],
    illustration({ first: true, second: true }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
