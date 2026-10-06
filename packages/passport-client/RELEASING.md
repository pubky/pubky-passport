# Releasing @pubky/passport-client

Releases are published from GitHub Actions with npm provenance
(`.github/workflows/publish-passport-client.yml`), never from a laptop.

## One-time setup (npm and repository admin)

1. On npmjs.com, make sure the `@pubky` organisation exists and the publishing account is a member
   with publish rights.
2. Create a **granular access token** for that account with read and write access to
   `@pubky/passport-client` (or to the `@pubky` scope for the first publish), with 2FA enforced on
   the account.
3. In the GitHub repository, create an environment named `npm` (Settings → Environments), limit it to
   protected tags `passport-client-v*` and, if wanted, require a reviewer. Add the token there as the
   secret `NPM_TOKEN`.

## Each release

1. The release is merged: the version in `packages/passport-client/package.json` and the entry in
   `CHANGELOG.md` are on `main`, and CI is green there.
2. Check what will be uploaded:
   ```bash
   pnpm --filter @pubky/passport-client build
   cd packages/passport-client && npm pack --dry-run
   ```
   The tarball holds `dist/`, `src/` without tests, `README.md`, `CHANGELOG.md`, `LICENSE` and
   `THIRD_PARTY_NOTICES.md`.
3. Tag the merge commit and push the tag:
   ```bash
   git tag -s passport-client-v0.1.0 -m "@pubky/passport-client 0.1.0"
   git push origin passport-client-v0.1.0
   ```
   The workflow checks that the tag matches the package version, runs the audit, the package's
   typecheck, unit tests and build, and publishes with provenance.
4. Check the release: `npm view @pubky/passport-client@0.1.0` and its provenance on npmjs.com.
5. Create a GitHub release for the tag with the changelog entry.
6. Remove "not on npm yet" from the package README, `docs/integration.md` and the root README.

For a later version: bump `version` in `package.json` (semver; anything that changes the element's
attributes, events, `::part`s, CSS properties, message keys or the headless API is breaking while
the version is 0.x, so bump the minor), add a `CHANGELOG.md` entry, merge, then tag
`passport-client-v<version>`.
