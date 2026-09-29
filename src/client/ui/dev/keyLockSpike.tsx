"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Result } from "better-result";
import { KeyLockSpike } from "@/client/logic/local-identity/key-lock/spike/KeyLockSpike";
import { SPIKE_ACTIONS } from "@/libs/keyLockSpikeReport";

const LABELS = {
  P: "probe",
  C: "create",
  G: "get",
  G2: "get by credential",
  R: "get again",
  W: "wait 1 second, get",
  I: "import, get",
  H: "two chained gets",
  X: "create excluding stored",
  S: "get with second input",
  E: "observed error names",
};

export function KeyLockSpikeView() {
  const [spike] = useState(() => new KeyLockSpike());
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const { busy, ...report } = useSyncExternalStore(
    spike.subscribe,
    spike.getSnapshot,
    spike.getSnapshot,
  );
  useEffect(() => {
    addEventListener("pagehide", spike.dispose, true);
    addEventListener("freeze", spike.dispose, true);
    return () => {
      spike.dispose();
      removeEventListener("pagehide", spike.dispose, true);
      removeEventListener("freeze", spike.dispose, true);
    };
  }, [spike]);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Key lock device spike</h1>
      <p>
        Development diagnostic. No Pubky keys are used. C replaces this spike’s saved credential
        reference; Forget removes only that reference.
      </p>
      <p>
        Send or copy the report before reloading, closing or restarting, then send again after G.
        Compare the first fingerprints across reports. Keep this passkey until testing is finished.
      </p>
      <label className="block">
        Diagnostic reference for another device (keep separate from reports)
        <textarea
          aria-label="Diagnostic reference"
          maxLength={4096}
          className="mt-2 w-full border p-2"
          onChange={(event) => {
            const preview = spike.previewReference(event.currentTarget.value);
            setReferencePreview(Result.isOk(preview) ? preview.value : null);
          }}
        />
      </label>
      <p className="break-all">
        {referencePreview
          ? `Import will use credential ID: ${referencePreview}`
          : "Paste a valid reference to preview its credential ID before importing."}
      </p>
      <div className="flex flex-wrap gap-2">
        {SPIKE_ACTIONS.map((action) => (
          <button
            className="rounded border px-3 py-2 disabled:opacity-50"
            disabled={busy || (action === "Import diagnostic reference" && !referencePreview)}
            key={action}
            onClick={() => {
              void spike.run(action);
            }}
            type="button"
          >
            {action in LABELS ? `${action} — ${LABELS[action as keyof typeof LABELS]}` : action}
          </button>
        ))}
      </div>
      <p role="status">{busy ? "Running…" : "Ready"}</p>
      <pre
        aria-label="Spike report log"
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-xs"
      >
        {JSON.stringify(report, null, 2)}
      </pre>
    </main>
  );
}
