# Contributing to oq

Use `nix develop` in the repository, then `just test`, `just lint`, `just build`,
and `just package`. Rust, the WASM standard library, Node, and tool packages are
pinned through `flake.lock`. `rust-toolchain.toml` supplies the same Rust version
to native non-Nix CI legs. The Nix shell declares Git for the real local-Git
integration fixtures; provide Git explicitly when testing outside Nix.
`npm ci --ignore-scripts` installs the locked
TypeScript compiler and the public Yarn 4.13.0 integration-test tool. Normal
root `npm ci`/`npm install` prepare source-package inputs without invoking Rust;
`just build-bindings` / `npm run build` explicitly compile local WASM.

Keep the document engine independent of any application's schemas. Public API
documentation should explain errors and preservation guarantees. Tests should use
real Org documents and filesystem boundaries wherever possible.

The concrete Org tree is provided by orgize; `oq-core` adds source ranges and a
JSON view. Org's literal-block comma-quoting rules apply: `,*` inside a source
or example block is literal text, while an unescaped column-zero heading remains
an outline node. See the [Org manual](https://orgmode.org/manual/Literal-Examples.html).
Paired tests cover both cases, plus exact UTF-8/CRLF byte and line positions.
The original source supplies all exposed content without pre-processing.

The jq compiler/interpreter is jaq. Programs are compiled once per rule and
reused for its selected nodes. The schema loader compiles even inactive rules.
Schema text is passed explicitly to both Rust and JS APIs; overlays do not
require rebuilding either binary.

Mutation compares the transformed JSON with its original view, resolves writable
scalars to byte spans, rejects overlaps and conflicts, and reparses the result to
verify shape and scalar round trips. The root `sections` lookup and `children`
tree share source locations; edits through either view work, while conflicting
changes fail before a file write.

`scripts/build-bindings.mjs` invokes the locked TypeScript compiler and the shared
`scripts/build-wasm.mjs` producer for the actual `oq-wasm` crate. The runtime
wrapper only handles allocation/JSON transport.
Each invocation owns a fresh Cargo output directory so a shared inherited target
cannot substitute another source preparation's engine. The
[bindings build contract](bindings-build.md) describes artifact provenance,
cleanup, and the deliberate compiled-cache reuse tradeoff.
Node tests compare parsed trees, queries, edited source, modes, and exact
diagnostics with the native CLI. They also test repeated errors, Unicode,
independent response ownership, and steady memory reuse after warmup.

`just package` and `just release-package` build bindings and stage a separate
prebuilt manifest with no installation build hooks. `just test-package` installs
that archive with normal scripts and executes the public exports while Rust is
unavailable. Published release tarballs contain WASM/declarations and require only
a supported JavaScript runtime.

Git dependencies fetch a source-only archive. Checkout `prepare` emits JS/types
and the exact Rust subtree; dependency `postinstall` always builds that subtree
after fetched-source selection/validation, even if a previous WASM survives.
Yarn verifies the archive checksum; npm Git identifies the pinned commit.
Git installation needs enabled scripts, Cargo/Rust, and the WASM standard
library. Normal `npm rebuild @agent-harbor/oq` / `yarn rebuild @agent-harbor/oq`
build the installed sources again. See the [layout/lifecycle contract](source-packages.md).

`just test-build-provenance` additionally prepares two same-version source
packages with old timestamps and a warm foreign Cargo target, installs them in
isolated consumers, and checks native/WASM behavior, declarations, and cache
preservation. It compiles the historical fixture and each selected preparation
with real Rust, so this part of `just test` takes a few minutes.

`just test-source-packages` uses actual npm Git and the locked public Yarn tool
with real owned Git fixtures and cold caches. Different real optimization inputs
must retain the same archive checksum/lock while producing different correct
installed engines. A historical compiled-archive fixture must reproduce Yarn
`YN0018`. `node scripts/test-source-packages.mjs --toolchains <bin-a> <bin-b>`
runs the same checks with two explicitly provided toolchains for acceptance;
the mandatory suite requires only the pinned compiler. These tests also check LF
checkout rules, strict layouts, phase order, rebuilds, and failure cleanup.

CI tests Linux x64/arm64, macOS arm64, and Windows x64/arm64 on self-hosted runners.
Native archive builds select musl on Linux and static CRT on MSVC, following the
[Rust linkage contract](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes).
The extracted-artifact test checks ELF interpreter absence on Linux and PE import
tables for dynamic CRT dependencies on Windows, then executes the archived CLI.
Nix packages are built on the three Nix-capable legs. Every job preserves logs;
an archive job mirrors them to the configured S3-compatible artifact store.
Repository onboarding supplies `MCL_S3_ARTIFACTS_*` variables/secrets. The mirror
is advisory and reports absent configuration; test prerequisites always fail if
missing. Tags trigger the release workflow, which requires a tag reachable from
`stable`, signing credentials, and publishing tokens. Do not create tags or
publish packages as part of ordinary feature work.
