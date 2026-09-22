"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useRef } from "react";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "@/libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "@/libs/authorization/earlyGoogleImplicitResponse";

/** Inserts executable scripts into initial HTML without rendering script elements on the client. */
export function ParserTimeScripts() {
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;

    return (
      <>
        <script>{EARLY_AUTHORIZATION_LOCATION_SCRIPT}</script>
        <script>{EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT}</script>
      </>
    );
  });

  return null;
}
