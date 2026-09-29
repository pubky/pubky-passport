import { z } from "zod";

export const SPIKE_ACTIONS = [
  "P",
  "C",
  "G",
  "G2",
  "R",
  "W",
  "I",
  "H",
  "X",
  "S",
  "E",
  "Forget",
  "Copy report",
  "Send report",
  "Copy diagnostic reference",
  "Import diagnostic reference",
] as const;
export type SpikeAction = (typeof SPIKE_ACTIONS)[number];
export const SPIKE_ERROR_NAMES = [
  "NotAllowedError",
  "NotFoundError",
  "InvalidStateError",
  "SecurityError",
  "NotSupportedError",
  "TypeError",
  "AbortError",
  "SyntaxError",
  "DataError",
  "OperationError",
  "QuotaExceededError",
  "UnknownError",
] as const;
export const SPIKE_TRANSPORTS = ["internal", "hybrid", "usb", "nfc", "ble", "smart-card"] as const;
const observationNames = z.array(z.string().max(64)).max(32);
const fingerprint = z.string().regex(/^[0-9a-f]{8}$/);
const flag = z.boolean().optional();
const errorName = z.enum(SPIKE_ERROR_NAMES);
const spikeEntrySchema = z.strictObject({
  action: z.enum(SPIKE_ACTIONS),
  at: z.iso.datetime(),
  ms: z.number().finite().nonnegative(),
  importMs: z.number().finite().nonnegative().optional(),
  activeAtClick: flag,
  activeAtCall: flag,
  up: flag,
  uv: flag,
  be: flag,
  bs: flag,
  enabled: flag,
  first: fingerprint.optional(),
  second: fingerprint.optional(),
  attachment: z.enum(["platform", "cross-platform", "unknown"]).optional(),
  transports: z.array(z.enum(SPIKE_TRANSPORTS)).max(SPIKE_TRANSPORTS.length).optional(),
  other: z
    .strictObject({
      transports: observationNames.optional(),
      capabilities: observationNames.optional(),
      truncated: z.literal(true).optional(),
    })
    .optional(),
  secure: flag,
  opener: flag,
  locks: flag,
  stored: flag,
  platform: flag,
  webauthn: flag,
  maxTouchPoints: z.number().int().nonnegative().optional(),
  clientEngine: z.enum(["webkit", "other"]).optional(),
  capabilities: z
    .record(z.string().max(64), z.boolean())
    .refine((v) => Object.keys(v).length <= 32)
    .optional(),
  errorName: errorName.optional(),
  errors: z.array(errorName).max(SPIKE_ERROR_NAMES.length).optional(),
});
export type SpikeEntry = z.infer<typeof spikeEntrySchema>;
export const keyLockSpikeReportSchema = z.strictObject({
  version: z.literal(0),
  userAgent: z.string().max(2048),
  entries: z.array(spikeEntrySchema).max(48),
  droppedEntries: z.number().int().nonnegative().optional(),
  invalidEntries: z.number().int().nonnegative().optional(),
});
export const SPIKE_REPORT_MAX_BYTES = 16 * 1024;

/** Invalid observations cannot poison later ceremonies or exports; counters explain omitted evidence. */
export function prepareSpikeReport(source: {
  userAgent: string;
  entries: readonly SpikeEntry[];
  droppedEntries: number;
  invalidEntries: number;
}) {
  const report = {
    version: 0 as const,
    userAgent: source.userAgent.slice(0, 2048),
    entries: [] as SpikeEntry[],
    droppedEntries: source.droppedEntries,
    invalidEntries: source.invalidEntries,
  };
  for (const entry of source.entries) {
    const parsed = spikeEntrySchema.safeParse(entry);
    if (parsed.success) report.entries.push(parsed.data);
    else report.invalidEntries += 1;
  }
  while (
    report.entries.length > 48 ||
    new TextEncoder().encode(JSON.stringify(report)).byteLength > SPIKE_REPORT_MAX_BYTES
  ) {
    report.entries.shift();
    report.droppedEntries += 1;
  }
  return report;
}
