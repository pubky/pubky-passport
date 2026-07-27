"use client";

import { useState, type FormEvent } from "react";

import type { BrowserManualAuthorizationController } from "../browser/authorization/browserManualAuthorizationController";
import { createBrowserManualAuthorizationController } from "../browser/authorization/createBrowserManualAuthorizationController";

const defaultAuthorization = createBrowserManualAuthorizationController();

export function ManualAuthorizationForm({
  authorization = defaultAuthorization,
}: {
  authorization?: BrowserManualAuthorizationController;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = authorization.enter(request);
    setRequest("");
    if (result === "invalid") {
      setError("The invalid request was cleared for security. Correct it in the source app, then paste the complete request again.");
      return;
    }

    setError(null);
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-medium">Authorize an app</h2>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <textarea
          aria-label="Pubky authorization request"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          onChange={(event) => setRequest(event.target.value)}
          placeholder="pubkyauth://signin?..."
          rows={4}
          spellCheck={false}
          value={request}
        />
        <button className="w-fit rounded border px-3 py-2" type="submit">Continue</button>
      </form>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </section>
  );
}
