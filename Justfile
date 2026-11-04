set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

build:
    @node scripts/logged.mjs build cargo build --locked --release -p oq

test: test-native test-schema-consumer test-bindings test-package test-build-provenance test-source-packages test-dist

test-native:
    @node scripts/logged.mjs native cargo test --locked --workspace --all-targets

test-schema-consumer:
    @node scripts/logged.mjs schema-consumer cargo run --locked --offline --target-dir target/schema-consumer --manifest-path tests/schema-consumer/Cargo.toml

test-workflow-triggers:
    @node scripts/logged.mjs workflow-triggers node scripts/test-workflow-triggers.mjs

npm-dependencies:
    @node scripts/logged.mjs npm-dependencies npm ci --ignore-scripts

build-bindings: npm-dependencies
    @node scripts/logged.mjs bindings-build npm run build

test-bindings: build-bindings
    @node scripts/logged.mjs native-cli cargo build --locked -p oq
    @node scripts/logged.mjs bindings npm test

lint:
    @node scripts/logged.mjs discovery-docs node scripts/sync-discovery.mjs --check
    @node scripts/logged.mjs toolchain node scripts/toolchain-config.mjs --check
    @node scripts/logged.mjs format cargo fmt --all --check
    @node scripts/logged.mjs consumer-format cargo fmt --manifest-path tests/schema-consumer/Cargo.toml -- --check
    @node scripts/logged.mjs clippy cargo clippy --locked --workspace --all-targets -- -D warnings
    @node scripts/logged.mjs types node node_modules/typescript/bin/tsc -p bindings/js/tsconfig.json --noEmit
    @node scripts/logged.mjs workflows actionlint

fmt:
    cargo fmt --all

sync-discovery:
    node scripts/sync-discovery.mjs

package: npm-dependencies
    @node scripts/logged.mjs npm-package node scripts/pack-release.mjs .result

test-package: package
    @node scripts/logged.mjs package-consumer node scripts/test-package.mjs

test-build-provenance:
    @node scripts/logged.mjs build-provenance node scripts/test-build-provenance.mjs

test-source-packages: build-bindings
    @node scripts/logged.mjs source-packages node scripts/test-source-packages.mjs

dist:
    @node scripts/logged.mjs dist-build node scripts/build-native-release.mjs
    @node scripts/logged.mjs dist node scripts/dist.mjs

test-dist: dist
    @node scripts/logged.mjs dist-consumer node scripts/test-dist.mjs

test-release:
    @node scripts/logged.mjs release-signing node scripts/test-release.mjs
    @node scripts/logged.mjs versioning node scripts/test-version.mjs

test-halt-mutation:
    @node scripts/logged.mjs halt-mutation node scripts/test-halt-mutation.mjs

release-package: npm-dependencies
    @mkdir -p .result/release
    @node scripts/logged.mjs release-package node scripts/pack-release.mjs .result/release

release-sign:
    @node scripts/logged.mjs release-signing node scripts/release-sign.mjs

mirror-artifacts:
    @bash scripts/mirror-artifacts.sh .result/ci-artifacts

clean:
    cargo clean

bump-version version:
    node scripts/bump-version.mjs {{version}}
