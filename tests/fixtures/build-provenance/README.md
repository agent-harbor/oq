# Historical engine input

`document-before.rs` is the unchanged public
[`crates/oq-core/src/document.rs` at a50a4e323e97a338772e04d0eb63171bc915baae](https://github.com/agent-harbor/oq/blob/a50a4e323e97a338772e04d0eb63171bc915baae/crates/oq-core/src/document.rs),
Git blob `8bb847f232049c91ac70f66d25fefc4590e57a61`.

The provenance regression compiles this actual older engine module with the
unchanged workspace manifests to seed a same-version foreign target. It exposes
the historical lowercase-checkbox, missing-projection, and empty-column behavior
through the actual Rust/WASM boundary. Freezing this source keeps the regression
usable in shallow checkouts without downloading history. It is test data only;
production never selects it. Do not regenerate it from the current engine.
