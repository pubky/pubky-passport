import type { Page } from "@playwright/test";

export const LOCAL_IDENTITY_STORAGE_ROOT = "pubky-passport/local-identities/v1";
/** Base64url of 32 bytes of 0x01: the secret key behind `PROFILE_KEY` in `pubkyProfile.ts`. */
export const TEST_SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

export type SeededIdentity = {
  publicKeyZ32: string;
  googleAccount?: {
    googleSubject: string;
    name: string;
    email: string;
    pictureUrl: string | null;
  };
  profileSetupRequired?: true;
};

/**
 * Writes local-identity records in their stored shape, each with `TEST_SECRET_KEY`. Only an
 * identity whose public key is `PROFILE_KEY` can therefore sign. `replace` clears storage first.
 */
export async function storeLocalIdentities(
  page: Page,
  identities: readonly SeededIdentity[],
  { active, replace = true }: { active?: string; replace?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ root, records, active, replace }) => {
      if (replace) localStorage.clear();
      for (const record of records) {
        localStorage.setItem(`${root}/identity/${record.publicKeyZ32}`, JSON.stringify(record));
      }
      if (active) localStorage.setItem(`${root}/active`, active);
    },
    {
      root: LOCAL_IDENTITY_STORAGE_ROOT,
      records: identities.map(({ publicKeyZ32, ...fields }) => ({
        v: 1,
        publicKeyZ32,
        secretKey: TEST_SECRET_KEY,
        ...fields,
      })),
      active: active ?? null,
      replace,
    },
  );
}
