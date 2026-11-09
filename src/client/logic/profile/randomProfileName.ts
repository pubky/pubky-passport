/**
 * The words of pubky.app's random names ("Blue-Rabbit-Hat"), so a profile Passport starts reads
 * like one pubky.app would have suggested.
 */
const ADJECTIVES = [
  "Blue",
  "Red",
  "Green",
  "Golden",
  "Silver",
  "Purple",
  "Orange",
  "Pink",
  "Cosmic",
  "Bright",
  "Swift",
  "Noble",
  "Brave",
  "Calm",
  "Bold",
  "Wild",
  "Wise",
  "Lucky",
  "Happy",
  "Sunny",
  "Misty",
  "Rusty",
  "Dusty",
  "Frosty",
  "Mighty",
  "Gentle",
  "Clever",
  "Silent",
  "Ancient",
  "Mystic",
] as const;

const NOUNS = [
  "Rabbit",
  "Fox",
  "Wolf",
  "Bear",
  "Eagle",
  "Hawk",
  "Owl",
  "Tiger",
  "Lion",
  "Panda",
  "Koala",
  "Dolphin",
  "Falcon",
  "Phoenix",
  "Dragon",
  "Raven",
  "Sparrow",
  "Otter",
  "Badger",
  "Lynx",
  "Hat",
  "Star",
  "Moon",
  "Sun",
  "Cloud",
  "Storm",
  "Wave",
  "Stone",
  "Crystal",
  "Flame",
  "Frost",
  "Wind",
  "Thunder",
  "Shadow",
  "Light",
  "Blade",
  "Shield",
  "Crown",
  "Tower",
  "Garden",
] as const;

/** A uniform index below `size`, from the browser's random source. */
function randomIndex(size: number): number {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0]! % size;
}

/**
 * A random name for a new profile, as pubky.app makes one: Adjective-Noun-Noun with two different
 * nouns, such as "Blue-Rabbit-Hat". `pick` chooses an index below its argument (tests fix it).
 */
export function randomProfileName(pick: (size: number) => number = randomIndex): string {
  const adjective = ADJECTIVES[pick(ADJECTIVES.length)]!;
  const first = pick(NOUNS.length);
  // The second noun skips the first, so the two always differ.
  const second = (first + 1 + pick(NOUNS.length - 1)) % NOUNS.length;
  return `${adjective}-${NOUNS[first]!}-${NOUNS[second]!}`;
}
