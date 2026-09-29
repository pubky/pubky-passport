import "client-only";
import { Result } from "better-result";
import { z } from "zod";
import { decodeBase64Url, encodeBase64Url } from "@/libs/encoding/base64Url";
import {
  prepareSpikeReport,
  SPIKE_ERROR_NAMES,
  SPIKE_TRANSPORTS,
  type SpikeAction,
  type SpikeEntry,
} from "@/libs/keyLockSpikeReport";
import type { CodedFailure } from "@/libs/result";

const STORAGE_KEY = "pubky-passport/key-lock-spike/v0";
const stateSchema = z.strictObject({
  credentialId: z.string().min(1).max(1364),
  prfInput: z.string().length(43),
  transports: z.array(z.enum(SPIKE_TRANSPORTS)).max(SPIKE_TRANSPORTS.length),
  createdAt: z.iso.datetime(),
});
type SpikeState = z.infer<typeof stateSchema>;
type Snapshot = ReturnType<typeof prepareSpikeReport> & { busy: boolean };

/** Diagnostic credentials only. Raw extension results never enter the snapshot or report. */
export class KeyLockSpike {
  private snapshot: Snapshot = {
    busy: false,
    version: 0,
    userAgent: "",
    entries: [],
    droppedEntries: 0,
    invalidEntries: 0,
  };
  private listeners = new Set<() => void>();
  private pending: AbortController | undefined;
  private incoming: SpikeState | undefined;
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  dispose = () => {
    this.pending?.abort();
  };

  previewReference(value: string): Result<string, CodedFailure<"spike_failed">> {
    try {
      this.incoming = this.parseReference(value);
      return Result.ok(this.incoming.credentialId);
    } catch {
      this.incoming = undefined;
      return Result.err({ code: "spike_failed" });
    }
  }

  async run(action: SpikeAction): Promise<Result<void, CodedFailure<"busy" | "spike_failed">>> {
    if (this.pending) return Result.err({ code: "busy" });
    const pending = new AbortController();
    this.pending = pending;
    this.update({ ...this.snapshot, userAgent: navigator.userAgent, busy: true });
    const start = performance.now();
    const activeAtClick = navigator.userActivation?.isActive;
    const record = (fields: Partial<SpikeEntry> = {}) => {
      if (pending.signal.aborted) return;
      this.update({
        ...this.snapshot,
        busy: true,
        ...prepareSpikeReport({
          ...this.snapshot,
          entries: [
            ...this.snapshot.entries,
            {
              action,
              at: new Date().toISOString(),
              ms: performance.now() - start,
              activeAtClick,
              ...fields,
            },
          ],
        }),
      });
    };
    try {
      if (action === "P") record(await this.probe());
      else if (action === "Forget") {
        localStorage.removeItem(STORAGE_KEY);
        record();
      } else if (action === "E")
        record({
          errors: [
            ...new Set(
              this.snapshot.entries.flatMap((entry) => (entry.errorName ? [entry.errorName] : [])),
            ),
          ],
        });
      else if (action === "Copy report") {
        await navigator.clipboard.writeText(this.report());
        record();
      } else if (action === "Copy diagnostic reference") {
        await navigator.clipboard.writeText(JSON.stringify(this.read()));
        record();
      } else if (action === "Import diagnostic reference") {
        if (!this.incoming) throw new DOMException("", "DataError");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.incoming));
        record();
      } else if (action === "Send report") {
        const response = await fetch("/dev/key-lock-spike/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: this.report(),
          signal: pending.signal,
        });
        if (!response.ok) throw new DOMException("", "OperationError");
        record();
      } else if (action === "C" || action === "X") {
        const input = random();
        const existing = action === "X" ? this.read() : undefined;
        const vaultId = encodeBase64Url(random(16));
        const label = `Passport key lock · ${browserName()} · ${vaultId.slice(0, 4)}`;
        const activeAtCall = navigator.userActivation?.isActive;
        const credential = await navigator.credentials.create({
          signal: pending.signal,
          publicKey: {
            rp: { id: location.hostname, name: "Pubky Passport" },
            user: { id: random(), name: label, displayName: label },
            challenge: random(),
            pubKeyCredParams: [-8, -7, -257].map((alg) => ({ type: "public-key", alg })),
            authenticatorSelection: { residentKey: "discouraged", userVerification: "required" },
            attestation: "none",
            timeout: 120_000,
            excludeCredentials: existing ? [descriptor(existing)] : [],
            extensions: { prf: { eval: { first: input } } },
          },
        });
        const result = await inspect(credential, true);
        if (pending.signal.aborted) return Result.err({ code: "spike_failed" });
        if (action === "C") {
          const value: SpikeState = {
            credentialId: (credential as PublicKeyCredential).id,
            prfInput: encodeBase64Url(input),
            transports: result.transports ?? [],
            createdAt: new Date().toISOString(),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        }
        record({ ...result, activeAtCall });
      } else {
        const state = this.read();
        if (action === "W") await new Promise((resolve) => setTimeout(resolve, 1000));
        const importMs =
          action === "I"
            ? (await import("./spikeImportTime")).spikeImportTime() - start
            : undefined;
        for (let i = 0; i < (action === "H" ? 2 : 1); i++) {
          if (pending.signal.aborted) return Result.err({ code: "spike_failed" });
          const evalInput = {
            first: decode(state.prfInput),
            ...(action === "S" ? { second: random() } : {}),
          };
          const activeAtCall = navigator.userActivation?.isActive;
          const credential = await navigator.credentials.get({
            signal: pending.signal,
            publicKey: {
              rpId: location.hostname,
              challenge: random(),
              userVerification: "required",
              timeout: 120_000,
              allowCredentials: [descriptor(state)],
              extensions: {
                prf:
                  action === "G2"
                    ? { evalByCredential: { [state.credentialId]: evalInput } }
                    : { eval: evalInput },
              },
            },
          });
          const result = await inspect(credential, false);
          if (credential?.id !== state.credentialId) throw new DOMException("", "DataError");
          record({ ...result, activeAtCall, importMs });
        }
      }
      return Result.ok(undefined);
    } catch (e) {
      const name = e instanceof Error ? e.name : "UnknownError";
      record({
        errorName: SPIKE_ERROR_NAMES.find((allowed) => allowed === name) ?? "UnknownError",
      });
      return Result.err({ code: "spike_failed" });
    } finally {
      this.pending = undefined;
      this.update({ ...this.snapshot, busy: false });
    }
  }

  private report(): string {
    return JSON.stringify(prepareSpikeReport(this.snapshot));
  }

  private read(): SpikeState {
    return this.parseReference(localStorage.getItem(STORAGE_KEY));
  }

  private parseReference(raw: string | null): SpikeState {
    if (!raw) throw new DOMException("", "NotFoundError");
    if (raw.length > 4096) throw new DOMException("", "DataError");
    const state = stateSchema.safeParse(JSON.parse(raw));
    if (!state.success) throw new DOMException("", "DataError");
    decode(state.data.credentialId);
    if (decode(state.data.prfInput).byteLength !== 32) throw new DOMException("", "DataError");
    return state.data;
  }

  private async probe(): Promise<Partial<SpikeEntry>> {
    const fields: Partial<SpikeEntry> = {
      secure: isSecureContext,
      opener: Boolean(window.opener),
      locks: Boolean(navigator.locks),
      stored: localStorage.getItem(STORAGE_KEY) !== null,
      webauthn: typeof PublicKeyCredential !== "undefined",
      maxTouchPoints: navigator.maxTouchPoints,
      clientEngine: spikeClientEngine(navigator.userAgent, navigator.maxTouchPoints),
    };
    if (typeof PublicKeyCredential === "undefined") return fields;
    const [capabilities, platform] = await Promise.allSettled([
      Promise.resolve().then(() => PublicKeyCredential.getClientCapabilities?.()),
      Promise.resolve().then(() =>
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.(),
      ),
    ]);
    if (capabilities.status === "fulfilled" && capabilities.value) {
      const known: [string, boolean][] = [];
      const other: string[] = [];
      for (const [name, value] of Object.entries(capabilities.value)) {
        if (typeof value === "boolean" && name.length <= 64 && known.length < 32)
          known.push([name, value]);
        else other.push(name);
      }
      fields.capabilities = Object.fromEntries(known);
      if (other.length) fields.other = otherNames("capabilities", other);
    }
    if (platform.status === "fulfilled") fields.platform = platform.value;
    return fields;
  }

  private update(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

function random(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const decoded = decodeBase64Url(value);
  if (!decoded?.length) throw new DOMException("", "DataError");
  return new Uint8Array(decoded);
}
function descriptor(state: SpikeState): PublicKeyCredentialDescriptor {
  return {
    type: "public-key",
    id: decode(state.credentialId),
    // The installed DOM types predate WebAuthn L3's smart-card transport; the list is validated above.
    transports: state.transports.map((transport) =>
      transport === "smart-card" ? (transport as AuthenticatorTransport) : transport,
    ),
  };
}
function view(value: BufferSource): Uint8Array<ArrayBuffer> {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}
async function inspect(
  credential: Credential | null,
  creating: boolean,
): Promise<Partial<SpikeEntry>> {
  if (credential?.type !== "public-key") throw new DOMException("", "DataError");
  const key = credential as PublicKeyCredential;
  const prf = key.getClientExtensionResults().prf;
  const first = prf?.results?.first ? view(prf.results.first) : undefined;
  const second = prf?.results?.second ? view(prf.results.second) : undefined;
  try {
    const response = key.response;
    const data = creating
      ? (response as AuthenticatorAttestationResponse).getAuthenticatorData()
      : (response as AuthenticatorAssertionResponse).authenticatorData;
    if (data.byteLength < 37) throw new DOMException("", "DataError");
    const flags = new DataView(data).getUint8(32);
    if ((first && first.length !== 32) || (second && second.length !== 32))
      throw new DOMException("", "DataError");
    return {
      up: Boolean(flags & 1),
      uv: Boolean(flags & 4),
      be: Boolean(flags & 8),
      bs: Boolean(flags & 16),
      enabled: prf?.enabled,
      first: first ? await fingerprint(first) : undefined,
      second: second ? await fingerprint(second) : undefined,
      attachment:
        key.authenticatorAttachment === "platform" ||
        key.authenticatorAttachment === "cross-platform"
          ? key.authenticatorAttachment
          : "unknown",
      ...(creating
        ? {
            ...transportObservations(
              (response as AuthenticatorAttestationResponse).getTransports(),
            ),
          }
        : {}),
    };
  } finally {
    first?.fill(0);
    second?.fill(0);
  }
}
async function fingerprint(output: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", output)).subarray(0, 4),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function spikeClientEngine(ua: string, touchPoints: number): "webkit" | "other" {
  return /iPhone|iPad|iPod|CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\//.test(ua) ||
    (/Macintosh/.test(ua) && touchPoints > 1) ||
    (/AppleWebKit\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua))
    ? "webkit"
    : "other";
}
function browserName(): string {
  const ua = navigator.userAgent;
  return /Edg\/|EdgiOS\//.test(ua)
    ? "Edge"
    : /Chrome\/|CriOS\//.test(ua)
      ? "Chrome"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : spikeClientEngine(ua, navigator.maxTouchPoints) === "webkit"
          ? "Safari"
          : "Browser";
}

function transportObservations(values: string[]): Pick<SpikeEntry, "transports" | "other"> {
  const transports = SPIKE_TRANSPORTS.filter((value) => values.includes(value));
  const other = values.filter((value) => !SPIKE_TRANSPORTS.some((known) => known === value));
  return { transports, ...(other.length ? { other: otherNames("transports", other) } : {}) };
}
function otherNames(
  kind: "transports" | "capabilities",
  names: string[],
): NonNullable<SpikeEntry["other"]> {
  return {
    [kind]: names.slice(0, 32).map((name) => name.slice(0, 64)),
    ...(names.length > 32 || names.some((name) => name.length > 64)
      ? { truncated: true as const }
      : {}),
  };
}
