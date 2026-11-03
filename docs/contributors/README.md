# Contributing to oq

Use `nix develop` in the repository, then `just test`, `just lint`, `just build`,
and `just package`. Rust, the WASM standard library, Node, and tool packages are
pinned through `flake.lock`. `rust-toolchain.toml` supplies the same Rust version
to native non-Nix CI legs. `npm ci --ignore-scripts` installs the locked
TypeScript compiler; `just build-bindings` compiles WASM and declarations.

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

`scripts/build-bindings.mjs` compiles the actual `oq-wasm` crate and invokes the
locked TypeScript compiler. The wrapper only handles allocation/JSON transport.
Node tests compare parsed trees, queries, edited source, modes, and exact
diagnostics with the native CLI. They also test repeated errors, Unicode,
independent response ownership, and steady memory reuse after warmup.

`just test-package` installs the packed npm archive into an isolated temporary
consumer and executes its WASM without any source checkout dependency. A Git
dependency also works: npm's `prepare` builds from source, requiring the pinned
Rust toolchain with `wasm32-unknown-unknown`. Published tarballs already contain
the WASM and declarations and require only a supported JavaScript runtime.

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
