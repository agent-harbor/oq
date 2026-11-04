# Source archive identity and package layouts

> Status: ✓ Implemented

## Requirements

An immutable Git dependency must produce the same fetched source archive when
installed with different supported Rust toolchains or compiler flags. Yarn
validates its locked archive checksum before building the installed dependency;
npm Git selects the pinned commit and does not compare Git archive integrity.
The installed WASM must still be compiled from the selected Rust sources and caller
compiler inputs through the [owned artifact producer](bindings-build.md).

Source archives must never include compiled WASM, including an existing checkout
build. Release archives remain prebuilt and require no Rust compiler at install
time. Neither path weakens package-manager checksum validation, cleans a caller's
cache, downloads a compiler, or depends on a sibling checkout.

## Explicit layouts

The package manifest declares a versioned `oqPackage` object: `format: 1` and
`kind: "source"` or `kind: "prebuilt"`. Source layout classification uses only
the package's own files and this declaration, never package-manager environment
variables, cache paths, or the presence of `oq.wasm`.

| Layout           | Required structure                                                                                                                                       | npm bootstrap/install behavior                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source checkout  | Source manifest; tracked `oq-checkout.json` owner marker; root `Cargo.toml` and the complete declared workspace inputs                                   | Root `postinstall` validates the checkout and skips Rust. `prepare` compiles JS/declarations and stages Rust inputs.                                               |
| Packed source    | Source manifest; no root Cargo workspace or `crates/`; complete dedicated `bindings/js/rust/` subtree; prepared JS/declarations and installation scripts | Dependency `postinstall` always compiles the staged Rust sources into the installed `bindings/js/dist/oq.wasm`. A surviving WASM file never changes this behavior. |
| Prebuilt release | Prebuilt manifest; JS/declarations and WASM; no staged Rust sources or source lifecycle scripts                                                          | Normal installation uses the packaged WASM and never invokes Rust.                                                                                                 |

Generated staging inputs and local WASM are valid in a source checkout. WASM
created by an earlier install is valid in a packed-source installation, whose
next postinstall still rebuilds it. These generated outputs do not make a layout
mixed. Inconsistent manifests, unknown, and incomplete layouts fail explicitly.
A root Cargo manifest
without its required workspace files is not a packed source package. Packed
source archives exclude the checkout owner marker; unexpected root Cargo files
cannot turn an installed-source package into a bootstrap checkout.
The marker records layout intent, not authenticity or authorization. Packed
source preparation is already complete; invoking its `prepare` validates the
layout without recompiling or changing fetched inputs. Its explicit build and
standard package-manager rebuild commands use the same installed-source builder.

## Lifecycle boundary

Both npm Git installation and Yarn Git packing bootstrap the source checkout.
That bootstrap may run `postinstall` before `prepare`. Merely moving Rust
compilation from `prepare` to `postinstall` therefore cannot establish archive
identity. The source-checkout layout must skip Rust throughout bootstrap.

Checkout `prepare` performs only deterministic operations: compile the locked
TypeScript source into JS/declarations and copy an exact Rust source allowlist
into the dedicated subtree. A source package's literal `files` allowlist names
each archived file. It includes the prepared JS/declarations, lifecycle/builder
modules, Rust manifests/lock/toolchain declaration, and all production workspace
source files required by Cargo. It excludes root Cargo/workspace files, tests,
build targets, temporary staging directories, and **every** WASM output, even
when packing a warm checkout or using `npm pack --ignore-scripts`.

The packed source is fetched before the dependency's `postinstall` runs; Yarn's
strict archive checksum validation also precedes that hook. The hook uses only
the archived Rust subtree and builder.
It always builds in a fresh producer-owned Cargo target/intermediate directory,
validates Cargo's selected artifact, writes the installed WASM only after a
successful build, and reclaims its temporary build output on success or failure.
Caller compiler wrappers/configuration remain inputs; caller target contents
remain untouched. No compiler-output bytes enter the fetched source archive.

Source installation requires enabled lifecycle scripts, Cargo/Rust with the
`wasm32-unknown-unknown` standard library, and the normal locked Rust dependency
sources available to Cargo. It installs no toolchain automatically. A valid,
already prepared source archive installed without its build hook retains its
inputs but needs a standard rebuild with scripts enabled to supply WASM. If Git
preparation was disabled too, required fetched inputs may be missing: that layout
fails explicitly and cannot be repaired by rebuilding absent sources. A prebuilt
release is appropriate when build scripts are unavailable. npm's `npm rebuild @agent-harbor/oq`
and Yarn's `yarn rebuild @agent-harbor/oq` rebuild installed source packages;
prebuilt release packages have no Rust rebuild hook.

## Canonical text and staging

TypeScript explicitly emits LF newlines. This states the package contract;
TypeScript's current default already emits LF. Committed `.gitattributes`
requires LF for the tracked text inputs that enter source packages, including
Rust/manifests, build modules, README/license/contract, and TypeScript source.
It does not change byte-sensitive document fixtures. A real checkout with
`core.autocrlf=true` must still supply those package inputs with LF.

Staged manifests use stable field ordering, two-space JSON indentation, and a
final LF. Staging copies only the declared source files and adds no timestamps,
absolute paths, platform identifiers, or compiler-derived values. Temporary
staging directories are invocation-owned and removed after success or failure.
The exact archive allowlist, rather than cleanup of a warm WASM file, enforces
the source-only boundary.

## Contributor and release workflows

Root `npm ci`/`npm install` prepare deterministic source-package inputs. They no
longer build local WASM. Contributors use the existing explicit
`just build-bindings` / `npm run build` target for a usable local engine. A Git
dependency's normal installation still produces a usable installed engine
through its dependency `postinstall` after source fetching.

`just package` and `just release-package` explicitly build bindings and pack a
separate release staging directory. Its manifest copies only public package
metadata/exports, declares the prebuilt layout, and contains no source build,
install, prepare, or publish lifecycle hooks and no development dependencies.
Its exact file list includes JS, declarations, WASM, README, license, and the API
contract. Release staging rejects missing/invalid WASM and source-only inputs.
The existing signing/version/release consumers continue to use this prebuilt
archive. A narrow source-manifest publishing guard directs contributors to the
release-package target; it adds no publication approval flow.

## Implementation

[`build-wasm.mjs`](../../scripts/build-wasm.mjs) is the one fresh-owned-target
Cargo/artifact producer. [`package-layout.mjs`](../../scripts/package-layout.mjs)
declares exact inputs and validates layout intent. The
[preparation](../../scripts/prepare-package.mjs),
[installation](../../scripts/install-bindings.mjs), and
[release packaging](../../scripts/pack-release.mjs) entry points own their
distinct phases. Explicit checkout builds and installed-source builds share the
same Rust producer.

## Key integration tests

[`test-source-packages.mjs`](../../scripts/test-source-packages.mjs) runs real npm
Git and the locked public Yarn 4.13.0 tool against owned Git fixtures and cold
package/global/target caches. Strict immutable Yarn checks require identical
source archive bytes/checksum and lock under two real valid compiler inputs,
while the installed WASM hashes differ and both engines satisfy literal raw,
projection, span, edit, and declaration assertions. The required suite uses
release opt-level 0/1 with the pinned compiler. Explicit `--toolchains <bin-a>
<bin-b>` acceptance uses release opt-level 3 with both supplied environments;
Rust 1.94.1/1.95.0 acceptance is separate from the single-toolchain CI requirement.
The historical compiled-archive fixture must successfully prepare and then fail
the changed-input re-fetch specifically with Yarn `YN0018`.

The same suite checks actual compiler phase/input records, rebuilds with an
existing WASM, strict layouts/markers, source/compiler failure cleanup, unchanged
foreign caches, warm WASM exclusion, and LF Git checkout/staging controls.
[`test-package.mjs`](../../scripts/test-package.mjs) installs the actual prebuilt
archive with default scripts and executes its exports while Rust is unavailable.
The [historical warm-target regression](../../scripts/test-build-provenance.mjs)
retains literal API/span/read-only/cache/cleanup assertions; its stale producer
counterfactual explicitly builds, stages a prebuilt package, and reaches the
genuine old-behavior runtime assertion after successful compilation/installation.
