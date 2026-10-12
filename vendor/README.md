# Vendored Pubky SDK

`synonymdev-pubky-0.15.0-passport.fec912b.tgz` contains the upstream Pubky JS/WASM
SDK built from commit
[`fec912b399b75fbb5c81a43a73a8b40e136df99b`](https://github.com/pubky/pubky-homeserver/commit/fec912b399b75fbb5c81a43a73a8b40e136df99b).
Its SHA-256 is
`060de8986e9bbdf720bb4ae29b3fe6b88481ae679be0775f50c8ac4e7bfc4613`.

The npm release available when this change was implemented, `0.15.0`, predates
[scoped encryption approvals (#668)](https://github.com/pubky/pubky-homeserver/pull/668).
Accepting `e` with that released SDK would leave Passport unable to deliver the
requested keys and signed approval. The pinned commit also includes HPKE approval
delivery, so `af=v1` requests use `epk` instead of a shared relay secret. See the
[upstream protocol guide](https://github.com/pubky/pubky-homeserver/blob/fec912b399b75fbb5c81a43a73a8b40e136df99b/docs/scoped-encryption-keys.md).

No upstream Rust, encryption implementation or generated binding code is patched.
Packaging sets a distinct prerelease version and `gitHead`, and includes the
upstream MIT license. [pubky.LICENSE](pubky.LICENSE) is a copy of that license.
The source archive's Cargo.lock pins transitive Rust dependencies. The pnpm lockfile
pins the packaged artifact's integrity and its JavaScript dependencies.

To rebuild on Linux x86_64 with Node and rustup available:

```sh
bash vendor/rebuild-pubky-sdk.sh
```

The script verifies source and wasm-pack archive checksums, installs Rust 1.98.1
and the WASM target into `vendor/build/`, then runs upstream's `bundle_npm` build
and `npm pack --ignore-scripts`. It uses wasm-pack 0.15.0 and the Cargo.lock-matching
wasm-bindgen 0.2.128. The initial build used Node 24.21.0 and npm 11.19.0. Toolchains,
caches, source and intermediate artifacts remain under the ignored `vendor/build/`
directory. Ordinary `pnpm install --frozen-lockfile` uses the committed tarball and
requires no Rust toolchain.

Replace this dependency with an official npm release once it includes this protocol
and Passport's approval tests pass. Retain fail-closed parsing for `e` without
`af=v1`, and preserve `af` and `epk` when narrowing approved capabilities. Existing
bare grant requests remain supported. Homeservers must support `e` before apps
request it; the SDK's local signer sessions continue using `/:rw` without keys.
