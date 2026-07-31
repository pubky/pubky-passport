"use client";

import dynamic from "next/dynamic";

export const AUTHORIZATION_REVIEW_LOADER = dynamic(
  () => import("./authorizationReview")
    .then((module) => module.AuthorizationReview),
  {
    ssr: false,
    loading: () => (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Authorization request</h1>
        <p>Loading authorization review...</p>
      </main>
    ),
  },
);
