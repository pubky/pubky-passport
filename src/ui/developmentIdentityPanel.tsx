"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import { LocalStorageIdentityRepository } from "../browser/identity/localIdentityRepository";
import { BrowserPubky } from "../browser/pubky/browserPubky";
import { parsePubkyAuthRequest } from "../features/auth/parsePubkyAuthRequest";
import type { LocalIdentitySummary } from "../features/identity/localIdentity";
import type { PubkyIdentityKeyHandle } from "../features/identity/pubkyIdentity";

type ViewState = { identities: LocalIdentitySummary[]; activeIdentityId: string | null; message: string };

export function DevelopmentIdentityPanel({ relayOrigin }: { relayOrigin: string }) {
  const pubky = useRef<BrowserPubky | null>(null);
  const activeKeyHandle = useRef<PubkyIdentityKeyHandle | null>(null);
  const [state, setState] = useState<ViewState>({ identities: [], activeIdentityId: null, message: "Loading local identities." });
  const [authRequest, setAuthRequest] = useState("");

  useEffect(() => {
    pubky.current = new BrowserPubky();
    refresh("Ready.");
    return () => pubky.current?.dispose();
  }, []);

  function refresh(message: string): void {
    const stored = new LocalStorageIdentityRepository().list();
    if (Result.isError(stored)) {
      setState({ identities: [], activeIdentityId: null, message: "Could not read local identities." });
      return;
    }

    setState({ ...stored.value, message });
  }

  async function setupIdentity(): Promise<void> {
    if (!pubky.current) return;
    if (activeKeyHandle.current) {
      pubky.current.disposeIdentityKey({ keyHandle: activeKeyHandle.current });
      activeKeyHandle.current = null;
    }
    const created = await pubky.current.createIdentityKey();
    if (Result.isError(created)) return refresh("Could not create an identity.");

    const saved = await new LocalStorageIdentityRepository().saveIdentity({
      identityKeys: pubky.current,
      keyHandle: created.value.keyHandle,
    });
    pubky.current.disposeIdentityKey({ keyHandle: created.value.keyHandle });
    refresh(Result.isError(saved) ? "Could not store the identity." : "Identity created and stored locally.");
  }

  async function restoreIdentity(): Promise<void> {
    if (!pubky.current) return;
    if (activeKeyHandle.current) {
      pubky.current.disposeIdentityKey({ keyHandle: activeKeyHandle.current });
      activeKeyHandle.current = null;
    }
    const restored = await new LocalStorageIdentityRepository().restoreActiveIdentity({ identityKeys: pubky.current });
    if (!Result.isError(restored)) activeKeyHandle.current = restored.value.keyHandle;
    refresh(Result.isError(restored) ? "Could not restore the selected identity." : "Selected identity restored in memory.");
  }

  function selectIdentity(id: string): void {
    if (activeKeyHandle.current && pubky.current) {
      pubky.current.disposeIdentityKey({ keyHandle: activeKeyHandle.current });
      activeKeyHandle.current = null;
    }
    const selected = new LocalStorageIdentityRepository().select(id);
    refresh(Result.isError(selected) ? "Could not select that identity." : "Selected identity changed.");
  }

  function inspectAuthorizationRequest(): void {
    const parsed = parsePubkyAuthRequest(encodeURIComponent(authRequest), { allowedRelayOrigins: [relayOrigin] });
    if (Result.isError(parsed)) return refresh("Authorization request is invalid.");
    refresh(`Authorization request ready for ${parsed.value.review.requestingAppDisplayName ?? "an app"}.`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Pubky Passport development</h1>
      <section className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-medium">Identity</h2>
        <select aria-label="Active identity" onChange={(event) => selectIdentity(event.target.value)} value={state.activeIdentityId ?? ""}>
          <option value="">No local identity</option>
          {state.identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.publicIdentity.publicKeyDisplay}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2" onClick={setupIdentity} type="button">Set up local identity</button>
          <button className="rounded border px-3 py-2" disabled={!state.activeIdentityId} onClick={restoreIdentity} type="button">Restore selected identity</button>
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-medium">Authorization request</h2>
        <textarea aria-label="Pubky authorization request" onChange={(event) => setAuthRequest(event.target.value)} placeholder="pubkyauth://signin?..." rows={5} value={authRequest} />
        <button className="w-fit rounded border px-3 py-2" onClick={inspectAuthorizationRequest} type="button">Validate request</button>
      </section>
      <p aria-live="polite" className="text-sm text-neutral-600">{state.message}</p>
    </main>
  );
}
