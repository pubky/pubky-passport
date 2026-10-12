#!/usr/bin/env bash
# Rebuild the unmodified upstream SDK used for scoped encryption approvals.
set -euo pipefail

readonly upstream_commit=fec912b399b75fbb5c81a43a73a8b40e136df99b
readonly source_sha256=ccdf64c5df157402df877cf51fe763dd5596b275d42097271331e0bf6a274678
readonly wasm_pack_version=0.15.0
readonly wasm_pack_sha256=c09f971ecaed9a2efc80fdcea7a00ef6b53c7fadc8c57d1f61b53a6aa66b668a
readonly rust_version=1.98.1
readonly package_version=0.15.0-passport.fec912b

vendor_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly vendor_dir
readonly build_dir="$vendor_dir/build/pubky-fec912b"
readonly source_dir="$build_dir/source"
readonly pkg_dir="$source_dir/pubky-sdk/bindings/js/pkg"
rustup_bin=$(command -v rustup)
readonly rustup_bin
cargo_bin=$(command -v cargo)
readonly cargo_bin

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  printf '%s\n' 'This pinned build requires Linux x86_64.' >&2
  exit 1
fi

mkdir -p "$build_dir/bin" "$build_dir/tmp" "$source_dir"
export CARGO_HOME="$build_dir/cargo"
export CARGO_TARGET_DIR="$build_dir/target"
export RUSTUP_HOME="$build_dir/rustup"
export RUSTUP_TOOLCHAIN="$rust_version"
export XDG_CACHE_HOME="$build_dir/cache"
export TMPDIR="$build_dir/tmp"
export PATH="$build_dir/bin:$PATH"
# Avoid embedding the build directory in generated artifacts.
export RUSTFLAGS="--remap-path-prefix=$build_dir=/pubky-sdk-build"

curl --fail --location --silent --show-error \
  "https://codeload.github.com/pubky/pubky-homeserver/tar.gz/$upstream_commit" \
  --output "$build_dir/source.tar.gz"
printf '%s  %s\n' "$source_sha256" "$build_dir/source.tar.gz" | sha256sum --check
tar --extract --gzip --file "$build_dir/source.tar.gz" \
  --strip-components=1 --directory "$source_dir"
lockfile_checksum=$(sha256sum "$source_dir/Cargo.lock")
readonly lockfile_checksum

curl --fail --location --silent --show-error \
  "https://github.com/wasm-bindgen/wasm-pack/releases/download/v$wasm_pack_version/wasm-pack-v$wasm_pack_version-x86_64-unknown-linux-musl.tar.gz" \
  --output "$build_dir/wasm-pack.tar.gz"
printf '%s  %s\n' "$wasm_pack_sha256" "$build_dir/wasm-pack.tar.gz" | sha256sum --check
tar --extract --gzip --file "$build_dir/wasm-pack.tar.gz" \
  --strip-components=1 --directory "$build_dir/bin" \
  "wasm-pack-v$wasm_pack_version-x86_64-unknown-linux-musl/wasm-pack"

"$rustup_bin" toolchain install "$rust_version" --profile minimal \
  --target wasm32-unknown-unknown --no-self-update

# Run the same binding generator and isomorphic patch used by upstream releases.
# wasm-pack itself supplies the Cargo.lock-matching wasm-bindgen CLI.
cd "$pkg_dir"
"$cargo_bin" run --locked --bin bundle_npm
printf '%s\n' "$lockfile_checksum" | sha256sum --check
test -s pubky_bg.wasm
test -s pubky.d.ts
test -s index.js
test -s index.cjs
cp "$source_dir/LICENSE" LICENSE

# Only packaging metadata changes; Rust, WASM and generated bindings are upstream.
node --input-type=module - "$package_version" "$upstream_commit" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = process.argv[2];
pkg.gitHead = process.argv[3];
writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
NODE

npm pack --ignore-scripts --pack-destination "$vendor_dir"
cd "$vendor_dir"
sha256sum "synonymdev-pubky-$package_version.tgz"
