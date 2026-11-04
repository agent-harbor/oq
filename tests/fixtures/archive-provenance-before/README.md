# Historical compiled-archive producer

These unchanged public files come from
[`b4b6d79f35aa65dff54f0849af2574e28850863b`](https://github.com/agent-harbor/oq/tree/b4b6d79f35aa65dff54f0849af2574e28850863b):
`package.json`, `package-lock.json`, and `scripts/build-bindings.mjs`.

The source archive regression restores them only in an owned local Git fixture.
They compile the actual current Rust engine in a fresh owned target, then include
that WASM in Git preparation's fetched archive. Different valid compiler inputs
must therefore reproduce Yarn's checksum rejection after successful preparation.
No engine implementation or package manager is replaced. This fixture isolates
archive identity from the earlier shared-target freshness defect.
