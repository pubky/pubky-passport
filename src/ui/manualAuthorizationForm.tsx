"use client";

import { Result } from "better-result";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { parsePubkyAuthRequest } from "../features/auth/parsePubkyAuthRequest";

export function ManualAuthorizationForm({ relayOrigin, allowLocalhostRelay = false, allowLocalhostCallbacks }: {
  relayOrigin: string;
  allowLocalhostRelay?: boolean;
  allowLocalhostCallbacks: boolean;
}) {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const rawRequest = request.trim();
    setRequest("");
    const parsed = parsePubkyAuthRequest(encodeURIComponent(rawRequest), {
      allowedRelayOrigins: [relayOrigin],
      allowLocalhostRelay,
      allowLocalhostCallbacks,
    });
    if (Result.isError(parsed)) {
      setError("Enter a valid Pubky authorization request.");
      return;
    }

    const destination = `/authorize?d=${encodeURIComponent(rawRequest)}`;
    setError(null);
    router.replace(destination);
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-medium">Authorize an app</h2>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <textarea
          aria-label="Pubky authorization request"
          onChange={(event) => setRequest(event.target.value)}
          placeholder="pubkyauth://signin?..."
          rows={4}
          value={request}
        />
        <button className="w-fit rounded border px-3 py-2" type="submit">Continue</button>
      </form>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </section>
  );
}
