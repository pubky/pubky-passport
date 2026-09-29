import { invalidOption } from "./PassportConfigError.js";

export function resolveCapabilities(
  input: string,
  validateCapabilities: (input: string) => string,
  allowBroad = false,
): string {
  const normalized = input.normalize("NFC");
  const entries = normalized === "" ? [] : normalized.split(",");
  if (entries.length > 64 || entries.some((entry) => entry.length > 1_024)) invalidCapabilities();
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    if (colon <= 0) invalidCapabilities();
    const path = entry.slice(0, colon);
    if (
      new TextEncoder().encode(path).length > 972 ||
      /[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(path)
    )
      invalidCapabilities();
    if (!allowBroad && (path === "/" || path === "/pub/" || path.startsWith("/priv/")))
      invalidOption("capabilities", "Broad capabilities require allowBroadCapabilities.");
  }
  try {
    return validateCapabilities(normalized);
  } catch {
    return invalidCapabilities();
  }
}

function invalidCapabilities(): never {
  return invalidOption("capabilities", "Use valid, bounded Pubky capabilities.");
}
