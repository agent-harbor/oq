# oq contributor index

`oq` is standalone Org-mode document tooling. General parsing, queries, lossless
mutations, and declarative validation belong here; consumers supply their own
document schemas.

Read [docs/contract.md](docs/contract.md) before changing behavior and
[docs/contributors/README.md](docs/contributors/README.md) for the architecture.

Enter the pinned development environment with `nix develop` from this repository,
or use `direnv allow`. Outside Nix, `rust-toolchain.toml` pins Rust and the WASM
target; install Node matching `.node-version` and Just 1.51.0. Do not install
dependencies through ad-hoc fallback paths.

Run `just test` (native Cargo tests plus actual Node/WASM/CLI parity), `just lint`,
`just build`, and `just package`. The complete suite takes roughly seconds after
compilation; run it when developing or reviewing changes here. Use
`cargo test -p oq-core --test engine <name>` for iteration, followed by the complete
suite. Tests run through Cargo/Node; there is no Reprobuild recorded-test history.
Every runner keeps a unique full-output log under `.result/logs/`; failures print
the path and size. Real CLI subprocesses additionally retain separate argv/output
logs. Do not weaken assertions, silently skip tests, or replace the real WASM
module with a JavaScript implementation.

`crates/oq-core` owns parsing, jq evaluation, source spans, and generic schemas.
`crates/oq` owns filesystem/CLI adaptation. `crates/oq-wasm` owns only the documented
allocation ABI. `bindings/js` owns typed transport and actual WASM tests. Consumer
grammars belong in declarative schema data, not Rust branches.

Development lands on `agents`. Changes reach `dev` through merge-commit pull
requests with passing checks. Do not force-push shared branches or bypass hooks.
Public files and commit messages must remain self-contained and must not refer to
private specifications or other private repositories.

Use Conventional Commit subjects and multiline bodies. Do not add assistant
attribution trailers.
