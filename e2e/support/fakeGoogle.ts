import type { BrowserContext, Route } from "@playwright/test";

/**
 * Passport encrypts only for an HTTPS origin. This serves the local test server under one, so a
 * flow that writes a Passport file can run end to end. Register it before more specific routes:
 * Playwright tries the most recently added route first.
 */
export const HTTPS_ORIGIN = "https://passport.e2e.test";

export async function serveOverHttps(context: BrowserContext, target: string): Promise<void> {
  await context.route(`${HTTPS_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${target}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

export const GOOGLE_SUBJECT = "google-attach-subject";
export const GOOGLE_EMAIL = "attach@example.com";
const GOOGLE_PICTURE = "https://lh3.googleusercontent.com/a/e2e-attach";
/** A 1×1 brand-green PNG, standing in for a Google profile picture. */
const AVATAR_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhQHzT1W6SAAAAABJRU5ErkJggg==";
const APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type FakeDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  parents: string[];
  version: string;
  content?: string;
};

export type FakeGoogle = {
  /** Every Drive request as `METHOD path`, without query or token. */
  driveCalls: string[];
  files: Map<string, FakeDriveFile>;
  wrappingKeyBodies: unknown[];
  /** Grant only the private app-data permission on the next sign-in. */
  appDataOnly: boolean;
  /** Runs before each app-data listing; a test can add a file "from another device". */
  beforeAppDataList?: ((count: number) => void) | undefined;
};

/**
 * Stand-ins for Google's consent popup, the userinfo endpoint, Passport's wrapping-key endpoint
 * (the real one verifies the ID token with Google) and the Drive API, so attach and detach can
 * write, read and delete files as Drive does.
 */
export async function installFakeGoogle(context: BrowserContext): Promise<FakeGoogle> {
  const fake: FakeGoogle = {
    driveCalls: [],
    files: new Map(),
    wrappingKeyBodies: [],
    appDataOnly: false,
  };
  let nextId = 1;
  let appDataLists = 0;

  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    const request = new URL(route.request().url());
    const redirectUri = request.searchParams.get("redirect_uri");
    const state = request.searchParams.get("state");
    if (!redirectUri || !state) throw new Error("Google authorization lacks callback or state");
    const claims = Buffer.from(
      JSON.stringify({ sub: GOOGLE_SUBJECT, nonce: request.searchParams.get("nonce") }),
    ).toString("base64url");
    const response = new URL(redirectUri);
    response.hash = new URLSearchParams({
      access_token: "attach-drive-token",
      id_token: `header.${claims}.signature`,
      state,
      scope: fake.appDataOnly ? APP_DATA_SCOPE : `${APP_DATA_SCOPE} ${FILE_SCOPE}`,
      expires_in: "3600",
    }).toString();
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(response.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({
      json: {
        sub: GOOGLE_SUBJECT,
        email: GOOGLE_EMAIL,
        name: "Attach Test",
        picture: GOOGLE_PICTURE,
      },
    }),
  );
  await context.route(GOOGLE_PICTURE, (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from(AVATAR_PNG, "base64") }),
  );
  await context.route("**/api/wrapping-key/google", async (route) => {
    const body: unknown = route.request().postDataJSON();
    fake.wrappingKeyBodies.push(body);
    await route.fulfill({
      json: {
        wrappingKey: Buffer.alloc(32, 9).toString("base64url"),
        keyId: (body as { keyId?: string }).keyId ?? "e2e",
      },
    });
  });

  const cors = (route: Route) => ({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE",
    "access-control-allow-headers":
      route.request().headers()["access-control-request-headers"] ?? "authorization, content-type",
  });
  const metadata = (file: FakeDriveFile) => ({
    id: file.id,
    name: file.name,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    parents: file.parents,
    version: file.version,
    trashed: false,
  });
  const create = (fields: Omit<FakeDriveFile, "id" | "version">) => {
    const file = { ...fields, id: `file${nextId++}`, version: "1" };
    fake.files.set(file.id, file);
    return file;
  };

  await context.route(
    /^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/files/u,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors(route) });
      fake.driveCalls.push(`${request.method()} ${url.pathname}`);
      const headers = cors(route);
      const id = /\/files\/([^/]+)$/u.exec(url.pathname)?.[1];

      if (request.method() === "GET" && !id) {
        const q = url.searchParams.get("q") ?? "";
        const name = /name = '([^']+)'/u.exec(q)?.[1];
        const parent = /'([^']+)' in parents/u.exec(q)?.[1];
        const mimeType = /mimeType = '([^']+)'/u.exec(q)?.[1];
        if (url.searchParams.get("spaces") === "appDataFolder") {
          fake.beforeAppDataList?.(++appDataLists);
        }
        const files = [...fake.files.values()].filter(
          (file) =>
            (url.searchParams.get("spaces") === "appDataFolder") ===
              file.parents.includes("appDataFolder") &&
            (!name || file.name === name) &&
            (!mimeType || file.mimeType === mimeType) &&
            (!parent || parent === "root" || file.parents.includes(parent)),
        );
        return route.fulfill({ headers, json: { files: files.map(metadata) } });
      }
      if (request.method() === "GET" && id) {
        const file = fake.files.get(decodeURIComponent(id));
        if (!file) return route.fulfill({ status: 404, headers, json: {} });
        return url.searchParams.get("alt") === "media"
          ? route.fulfill({ headers, contentType: "application/json", body: file.content ?? "" })
          : route.fulfill({ headers, json: metadata(file) });
      }
      if (request.method() === "DELETE" && id) {
        fake.files.delete(decodeURIComponent(id));
        return route.fulfill({ status: 204, headers });
      }
      if (request.method() === "POST" && url.pathname.startsWith("/upload/")) {
        const parts = (request.postData() ?? "").split(/--pubky-passport-drive-boundary-v1/u);
        const body = (part: string | undefined) =>
          part?.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
        const fields = JSON.parse(body(parts[1]) ?? "{}") as { name: string; parents: string[] };
        const file = create({
          name: fields.name,
          parents: fields.parents,
          content: body(parts[2]) ?? "",
        });
        return route.fulfill({ headers, json: metadata(file) });
      }
      if (request.method() === "POST") {
        const fields = request.postDataJSON() as { name: string; mimeType: string };
        const file = create({
          name: fields.name,
          mimeType: fields.mimeType,
          parents: ["rootfolder"],
        });
        return route.fulfill({ headers, json: metadata(file) });
      }
      return route.fulfill({ status: 400, headers, json: {} });
    },
  );

  return fake;
}

/** The Passport file in the private app-data folder, if any. */
export function passportFile(fake: FakeGoogle): FakeDriveFile | undefined {
  return [...fake.files.values()].find((file) => file.parents.includes("appDataFolder"));
}
