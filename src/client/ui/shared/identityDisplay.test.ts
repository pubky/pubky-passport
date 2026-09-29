import { describe, expect, it } from "vitest";

import {
  identityDisplayName,
  KEY_COLORS,
  keyColor,
  profileName,
  unnamedKey,
} from "./identityDisplay";

const KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

function identity(publicKeyZ32: string, name?: string) {
  return {
    publicIdentity: { publicKeyZ32 },
    ...(name === undefined ? {} : { profile: { name } }),
  };
}

describe("identityDisplayName", () => {
  it("uses the profile name", () => {
    expect(identityDisplayName(identity(KEY, "Satoshi"))).toBe("Satoshi");
  });

  it("names an identity without a profile after its own key, so two never read the same", () => {
    expect(identityDisplayName(identity(KEY))).toBe("Pubky tkrq…p7qy");
    expect(identityDisplayName(identity(OTHER_KEY))).toBe("Pubky 5jsj…tryo");
  });

  it("treats a blank profile name as none", () => {
    expect(identityDisplayName(identity(KEY, "   "))).toBe("Pubky tkrq…p7qy");
    expect(profileName(identity(KEY, "  "))).toBeUndefined();
    expect(profileName(identity(KEY, " Satoshi "))).toBe("Satoshi");
  });
});

describe("unnamedKey", () => {
  it("gives the key only while the identity has no profile name", () => {
    expect(unnamedKey(identity(KEY))).toBe(KEY);
    expect(unnamedKey(identity(KEY, "Satoshi"))).toBeUndefined();
  });
});

describe("keyColor", () => {
  it("gives a key the same colour every time, from the palette", () => {
    const palette = KEY_COLORS.map(
      ({ hue, saturation, lightness }) => `hsl(${hue} ${saturation}% ${lightness}%)`,
    );
    expect(keyColor(KEY)).toBe(keyColor(KEY));
    expect(palette).toContain(keyColor(KEY));
  });

  it("spreads keys that differ in one character", () => {
    const colors = new Set(
      ["y", "b", "n", "d", "r", "f"].map((first) => keyColor(`${first}${KEY.slice(1)}`)),
    );
    expect(colors.size).toBeGreaterThan(4);
    expect(keyColor(KEY)).not.toBe(keyColor(OTHER_KEY));
  });

  it("keeps its hues well apart and the white person glyph legible on every colour", () => {
    const hues = [...new Set(KEY_COLORS.map(({ hue }) => hue))].sort((a, b) => a - b);
    expect(hues.length).toBeGreaterThanOrEqual(8);
    for (const [index, hue] of hues.entries())
      expect((hues[index + 1] ?? hues[0]! + 360) - hue).toBeGreaterThanOrEqual(36);
    for (const color of KEY_COLORS)
      expect(contrastWithWhite(color), JSON.stringify(color)).toBeGreaterThanOrEqual(4.5);
  });
});

/** WCAG contrast of white text on an HSL colour. */
function contrastWithWhite({
  hue,
  saturation,
  lightness,
}: {
  hue: number;
  saturation: number;
  lightness: number;
}): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
  return 1.05 / (luminance + 0.05);
}
