export function createAttemptId(random: Pick<Crypto, "getRandomValues">): string {
  const bytes = random.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
