# Bindings build provenance

> Status: ✓ Implemented

## Requirements

A source build, including the npm Git dependency `prepare` lifecycle, must
package the WebAssembly engine compiled from that source preparation. Matching
package versions, old source timestamps, and a warm caller-owned Cargo target
directory must not substitute an engine from another source preparation.
The JavaScript transport, declarations, and WASM must describe the same API.

The producer must preserve caller-owned build artifacts. It must not clean a
shared target, rewrite source timestamps, or require consumers to repair caches.
Compiler wrappers and other compiler configuration remain caller inputs.

## Design

Each bindings build creates a fresh temporary directory owned by that invocation.
It explicitly selects this directory for Cargo's target and intermediate build
outputs, regardless of inherited target/build-directory settings. Its identity
is the invocation itself: no artifacts from an earlier source preparation are
eligible for reuse. This avoids maintaining a second model of Cargo's source,
toolchain, feature, and configuration inputs. Cargo's registry/download cache
remains available; compiled dependencies are rebuilt for each invocation.

Cargo's JSON messages identify the `oq-wasm` library artifact for the selected
manifest and WASM target. The producer requires exactly one WASM output within
its owned directory, validates it as a WASM module, and copies those bytes into
the package alongside declarations compiled from the selected TypeScript source.
It never selects the inherited target's stable `oq_wasm.wasm` filename.
On success or failure it removes only its own temporary build directory.

## Implementation

[`scripts/build-bindings.mjs`](../../scripts/build-bindings.mjs) owns the Cargo
subprocess and artifact selection. `npm run build`, `npm run prepare`, and
`just build-bindings` use this same producer.

## Key integration tests

The [source-preparation regression](../../scripts/test-build-provenance.mjs)
uses the real Rust compiler, the [historical engine
source](../../tests/fixtures/build-provenance/README.md), and the npm
preparation/installation boundary. It warms a foreign
target with an older same-version engine, normalizes source mtimes, and checks
the installed newer engine's checkbox, table, display projection, and lossless
edit behavior against independent expected values. It verifies foreign artifact
bytes are unchanged and repeats preparation with fresh producer-owned outputs.
The producer's owned temporary output is reclaimed after successful builds and
an intentional compiler failure; unrelated temporary caches remain caller-owned.
