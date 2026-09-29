import { invalidOption } from "./PassportConfigError.js";

type PageLocation = Pick<Location, "origin" | "pathname">;

export function resolveReturnPath(input: string | undefined, page: PageLocation): string {
  const path = input ?? page.pathname;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\?#\p{Cc}]/u.test(path)) invalidPath();
  let url: URL;
  try {
    url = new URL(path, page.origin);
  } catch {
    return invalidPath();
  }
  if (url.origin !== page.origin || url.pathname !== path) invalidPath();
  return path;
}

export function buildReturnCallbacks(path: string, page: PageLocation, attemptId: string) {
  const validated = resolveReturnPath(path, page);
  const callback = (kind: "s" | "e" | "c") => {
    const url = new URL(validated, page.origin);
    url.search = `?pubky-passport=${kind}.${attemptId}`;
    return url.href;
  };
  return { xSuccess: callback("s"), xError: callback("e"), xCancel: callback("c") };
}

function invalidPath(): never {
  return invalidOption(
    "returnPath",
    "Use an unchanged absolute path without query, fragment or backslash.",
  );
}
