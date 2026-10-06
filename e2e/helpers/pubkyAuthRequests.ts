// The request shape comes from authorize.spec.ts; that spec remains unchanged.
export const CLIENT_RELAY_SECRET = ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
const CLIENT_PUBLIC_KEY = ["5jsjx1o6fzu6aeeo697r3i5rx15", "zq41kikcye8wtwdqm4nb4tryo"].join("");

export function clientAuthRequest(
  options: {
    relay?: string;
    capabilities?: string;
    appName?: string;
    clientId?: string;
    callbacks?: { success?: string; error?: string; cancel?: string };
  } = {},
): string {
  const request = new URL("pubkyauth://signin_grant");
  request.searchParams.set("caps", options.capabilities ?? "");
  request.searchParams.set("relay", options.relay ?? "https://relay.client.example/inbox");
  request.searchParams.set("secret", CLIENT_RELAY_SECRET);
  request.searchParams.set("cid", options.clientId ?? "client.example");
  request.searchParams.set("cpk", CLIENT_PUBLIC_KEY);
  for (const name of ["success", "error", "cancel"] as const) {
    const destination = options.callbacks?.[name];
    if (destination !== undefined) request.searchParams.set(`x-${name}`, destination);
  }
  return `${request.href}&x-source=${encodeURIComponent(options.appName ?? "ClientFixture")}`;
}

export function clientAuthorizationPath(request: string): string {
  return `/authorize#d=${encodeURIComponent(request)}`;
}
