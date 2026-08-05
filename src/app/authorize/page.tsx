"use client";

import { useEffect, useState } from "react";

import { createPassportAuthorizationController } from "../../browser/authorization/passportAuthorization";

export default function AuthorizePage() {
  const [controller] = useState(() => createPassportAuthorizationController());

  useEffect(() => {
    controller.commitInitialEntry();
  }, [controller]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Authorization</h1>
      <p>The new authorization interface is under construction.</p>
    </main>
  );
}
