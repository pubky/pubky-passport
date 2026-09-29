/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { stringHash } from "facehash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FACEHASH_AVATAR_COLORS, FacehashAvatar, facehashInitial } from "./facehashAvatar";

// pubky.app's own check vectors (pubky/pubky-app b49c813d): the bare z32 key is the seed.
const BLUE_KEY = "6mfxozzqmb36rc9rgy3rykoyfghfao74n8igt5tf1boehproahoy";
const RED_KEY = "o1gg96ewuojmopcjbz8895478dr7ginmrb4y3snwjgo51itdpg8y";
/** facehash's RoundFace: two round eyes in a 63×15 box. */
const ROUND_FACE_VIEW_BOX = "0 0 63 15";

/** Stubs matchMedia; the returned function changes the reduced-motion setting and notifies. */
function stubReducedMotion(initial: boolean) {
  let reduce = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && reduce;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: boolean) => {
    reduce = next;
    act(() => listeners.forEach((listener) => listener()));
  };
}

function renderFace(publicKey: string, profileName?: string) {
  const { container } = render(<FacehashAvatar profileName={profileName} publicKey={publicKey} />);
  const face = container.querySelector<HTMLElement>("[data-facehash]")!;
  return {
    face,
    eyes: face.querySelector("svg")!,
    blinking: () =>
      [...face.querySelectorAll<SVGGElement>("svg g")].map((eye) => eye.style.animation),
    turning: () => face.querySelector<HTMLElement>("[data-facehash-face]")!.style.transition,
  };
}

describe("FacehashAvatar", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    [BLUE_KEY, 394345316, "rgb(0, 75, 255)", "6"],
    [RED_KEY, 302639488, "rgb(255, 0, 0)", "O"],
  ])("gives %s pubky.app's face, colour and initial", (key, hash, colour, initial) => {
    expect(stringHash(key)).toBe(hash);
    const { face, eyes } = renderFace(key);

    expect(face.style.backgroundColor).toBe(colour);
    expect(eyes).toHaveAttribute("viewBox", ROUND_FACE_VIEW_BOX);
    expect(face).toHaveTextContent(new RegExp(`^${initial}$`, "u"));
    // Decorative: whatever holds it names the identity.
    expect(face).toHaveAttribute("aria-hidden", "true");
    expect(face).toHaveClass("h-full", "w-full", "rounded-full", "text-background");
    expect(face.style.width).toBe("100%");
    // The initial is the mouth, sized to the face, and facehash's own initial is off.
    expect(face.querySelector("[data-facehash-mouth] span")).toHaveStyle({ lineHeight: "1" });
    expect(face.querySelector("[data-facehash-mouth] span")?.getAttribute("style")).toContain(
      "font-size: 26cqw",
    );
    expect(face.querySelector("[data-facehash-initial]")).toBeNull();
  });

  it("keeps pubky.app's palette in pubky.app's order", () => {
    expect(FACEHASH_AVATAR_COLORS).toEqual([
      "#00FF5D",
      "#00F0FF",
      "#004BFF",
      "#FC00FF",
      "#FF0000",
      "#FF9900",
    ]);
  });

  it("shows the profile name's initial, and keeps the key's face and colour", () => {
    const unnamed = renderFace(RED_KEY);
    const named = renderFace(RED_KEY, "  satoshi nakamoto");

    expect(named.face).toHaveTextContent(/^S$/u);
    expect(named.face.style.backgroundColor).toBe(unnamed.face.style.backgroundColor);
    expect(named.eyes.outerHTML).toBe(unnamed.eyes.outerHTML);
  });

  it("picks the initial like pubky.app, in whole characters", () => {
    expect(facehashInitial(BLUE_KEY)).toBe("6");
    expect(facehashInitial(RED_KEY, "   ")).toBe("O");
    expect(facehashInitial(RED_KEY, " élodie")).toBe("É");
    expect(facehashInitial(RED_KEY, "ßeta")).toBe("S");
    expect(facehashInitial(RED_KEY, "🦊 Fox")).toBe("🦊");
  });

  it("blinks and turns on hover unless the person asked for less motion", () => {
    const setReducedMotion = stubReducedMotion(false);
    const { face, blinking, turning } = renderFace(BLUE_KEY);

    expect(blinking()).toEqual([
      expect.stringMatching(/^facehash-blink /u),
      expect.stringMatching(/^facehash-blink /u),
    ]);
    expect(turning()).not.toBe("");
    expect(face).toHaveAttribute("data-interactive", "true");

    setReducedMotion(true);
    expect(blinking()).toEqual(["", ""]);
    expect(turning()).toBe("");
    expect(face).not.toHaveAttribute("data-interactive");
    // It keeps its resting pose, so it still looks like the same face.
    expect(face.querySelector<HTMLElement>("[data-facehash-face]")!.style.transform).toMatch(
      /^rotateX/u,
    );
  });

  it("starts still with reduced motion", () => {
    stubReducedMotion(true);
    const { face, blinking } = renderFace(RED_KEY);

    expect(blinking()).toEqual(["", ""]);
    expect(face).not.toHaveAttribute("data-interactive");
  });

  it("draws in the page: no request, no script, no image", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const opened = vi.spyOn(XMLHttpRequest.prototype, "open");
    stubReducedMotion(false);
    const scripts = document.scripts.length;

    const { face } = renderFace(BLUE_KEY, "Satoshi");

    expect(fetch).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(document.scripts).toHaveLength(scripts);
    expect(face.querySelector("img, image, use, link, iframe, object")).toBeNull();
    // The blink keyframes are its only style element, which the policy's style-src allows.
    const styles = [...document.head.querySelectorAll("style")].map((style) => style.textContent);
    expect(styles.filter((style) => style?.includes("facehash-blink"))).toHaveLength(1);
    opened.mockRestore();
  });
});
