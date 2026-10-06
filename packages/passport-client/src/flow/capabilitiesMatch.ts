/** Compare validated scopes exactly; a broader grant is not an equivalent grant. */
export function capabilitiesMatch(
  requested: string,
  granted: readonly string[],
  normalize: (input: string) => string,
): boolean {
  try {
    const expected = scopes(normalize(requested));
    const actual = scopes(normalize(granted.join(",")));
    return (
      expected.size === actual.size &&
      [...expected].every(([path, actions]) => actual.get(path) === actions)
    );
  } catch {
    return false;
  }
}

function scopes(normalized: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!normalized) return result;
  for (const entry of normalized.split(",")) {
    const colon = entry.lastIndexOf(":");
    const path = entry.slice(0, colon);
    const actions = (result.get(path) ?? "") + entry.slice(colon + 1);
    result.set(path, [...new Set(actions)].sort().join(""));
  }
  return result;
}
