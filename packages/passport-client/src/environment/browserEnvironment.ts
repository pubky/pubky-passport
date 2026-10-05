export interface BrowserEnvironment {
  readonly topLevel: boolean;
  readonly protocol: string;
  readonly storageWritable: boolean;
  readonly inApp: boolean;
  readonly iosStandalone: boolean;
  readonly crossOriginIsolated: boolean;
  /** Undefined means the optional browser API is unsupported or unreadable. */
  readonly userActivation?: boolean;
}

const EMBEDDED_UA =
  /Instagram|FBAN|FBAV|FB_IAB|musical_ly|BytedanceWebview|Line\/|Snapchat|; wv\)/iu;
const IOS_UA = /iPad|iPhone|iPod/iu;
let nextProbe = 0;

/**
 * Click-time snapshot of routing capabilities. Probes sessionStorage by writing,
 * reading back and removing one unique key; never overwrites an existing key.
 * UA detection is a routing hint, not a trust check.
 */
export function browserEnvironment(appWindow: Window = window): BrowserEnvironment {
  const ua = read(() => appWindow.navigator.userAgent, "");
  const ios = IOS_UA.test(ua);
  const standalone = read(
    () => (appWindow.navigator as Navigator & { standalone?: boolean }).standalone === true,
    false,
  );
  const userActivation = read(() => appWindow.navigator.userActivation?.isActive, undefined);
  return Object.freeze({
    topLevel: read(() => appWindow.top === appWindow.self, false),
    protocol: read(() => appWindow.location.protocol, ""),
    storageWritable: probeSessionStorage(appWindow),
    inApp: EMBEDDED_UA.test(ua) || (ios && !/Safari\//iu.test(ua)),
    iosStandalone:
      standalone ||
      (ios && read(() => appWindow.matchMedia("(display-mode: standalone)").matches, false)),
    crossOriginIsolated: read(() => appWindow.crossOriginIsolated === true, false),
    ...(typeof userActivation === "boolean" ? { userActivation } : {}),
  });
}

function read<T>(operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}

function probeSessionStorage(appWindow: Window): boolean {
  // This random suffix only avoids probe-key collisions; it is never an authentication nonce.
  const key = `pubky-passport:probe:${++nextProbe}:${Math.random().toString(36).slice(2)}`;
  let storage: Storage | undefined;
  let cleanup = false;
  let writable = false;
  try {
    storage = appWindow.sessionStorage;
    if (storage.getItem(key) !== null) return false;
    cleanup = true;
    storage.setItem(key, "1");
    writable = storage.getItem(key) === "1";
  } catch {
    writable = false;
  } finally {
    if (cleanup) {
      try {
        storage?.removeItem(key);
      } catch {
        writable = false;
      }
    }
  }
  return writable;
}
