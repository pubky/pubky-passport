/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { fakeAppleIdentityController } from "@test-utils/fakeAppleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { IdentityEstablishmentFlow } from "../identityEstablishmentFlow";

// The import screens' chunk cannot be loaded, as offline or in an old tab after a deploy.
vi.mock("./importIdentityFlow", () => {
  throw new Error("Loading chunk failed");
});

afterEach(cleanup);

it("shows a way back instead of crashing when the import screens fail to load", async () => {
  const user = userEvent.setup();
  const fake = fakeAppleIdentityController();
  render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={null}>
        <IdentityEstablishmentFlow onComplete={vi.fn()} />
      </AppleIdentityConfigurationProvider>,
      {
        createAppleIdentityController: () => fake.controller,
        createGoogleIdentityController: () => mockGoogleIdentityController(),
      },
    ),
  );

  await user.click(screen.getByRole("button", { name: "Import it" }));
  expect(await screen.findByRole("heading", { name: "Import unavailable." })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
});
