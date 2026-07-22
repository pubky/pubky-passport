import { Result } from "better-result";
import Link from "next/link";

import { parsePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import { publicEnv } from "../../libs/env/public-env";

export default async function AuthorizePage({ searchParams }: {
  searchParams: Promise<{ d?: string | string[] }>;
}) {
  const d = (await searchParams).d;
  const parsed = parsePubkyAuthRequest(typeof d === "string" ? encodeURIComponent(d) : undefined, {
    allowedRelayOrigins: [new URL(publicEnv.NEXT_PUBLIC_HTTP_RELAY_URL).origin],
    allowLocalhostCallbacks: process.env.NODE_ENV === "development",
  });

  if (Result.isError(parsed)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Invalid authorization request</h1>
        <p>The request cannot be safely authorized.</p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header>
        <p className="text-sm text-neutral-600">Authorization request</p>
        <h1 className="text-2xl font-semibold">{parsed.value.review.requestingAppDisplayName ?? "An app"}</h1>
      </header>
      <section className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-medium">Requested permissions</h2>
        {parsed.value.review.capabilities.map((capability, index) => (
          <div className="rounded border p-3" key={`${index}:${capability.path}`}>
            <code>{capability.path}</code>
            <p className="text-sm">{[capability.read ? "Read" : null, capability.write ? "Write" : null].filter(Boolean).join(" and ")}</p>
            {capability.scope === "broad" ? <p className="text-sm text-red-700">Broad access</p> : null}
          </div>
        ))}
      </section>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-2" disabled type="button">Approve</button>
        <Link className="rounded border px-3 py-2" href="/">Cancel</Link>
      </div>
      <p className="text-sm text-neutral-600">Signing is not connected to this review surface yet.</p>
    </main>
  );
}
