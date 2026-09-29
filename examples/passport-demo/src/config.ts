import type { Capabilities } from "@synonymdev/pubky";

export const APP_CLIENT_ID = "template" as const;
export const APP_PATH = `/pub/${APP_CLIENT_ID}/` as const;
export const APP_CAPABILITIES = `${APP_PATH}:rw` as Capabilities;

export const IS_TESTNET = import.meta.env.VITE_PUBKY_TESTNET !== "false";
export const TESTNET_HOST = import.meta.env.VITE_PUBKY_TESTNET_HOST || undefined;
export const HTTP_RELAY =
  import.meta.env.VITE_PUBKY_HTTP_RELAY?.trim() ||
  (IS_TESTNET ? `http://${TESTNET_HOST ?? "localhost"}:15412/inbox/` : undefined);
export const STORAGE_NAMESPACE = import.meta.env.VITE_PUBKY_STORAGE_NAMESPACE?.trim() || undefined;

export const SHOW_DEVELOPMENT_SIGNUP =
  import.meta.env.DEV && IS_TESTNET && import.meta.env.VITE_SHOW_DEVELOPMENT_SIGNUP !== "false";

// Fixed homeserver public key used by Pubky's local testnet.
export const DEVELOPMENT_SIGNUP_HOMESERVER =
  "pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
