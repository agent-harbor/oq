# oq documentation

`oq` queries, edits, and validates Org-mode documents through one Rust engine.
Use the command-line application, the reusable `oq-core` crate, or the compiled
WebAssembly package for JavaScript and TypeScript.

See the [contract](contract.md) for the parsed document model, query examples,
lossless mutation boundaries, and declarative schemas. Consumers own their
domain-specific schemas. See the [README](../README.md) for installation and the
[contributor guide](contributors/README.md) for reproducible builds and tests.
The [source package contract](contributors/source-packages.md) distinguishes Git
installation/rebuilds from compiler-free prebuilt release archives.
