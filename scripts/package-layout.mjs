/** The bounded package inputs and explicit source/prebuilt ownership boundary. */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const rustDirectory = "bindings/js/rust";
export const rustInputs = [
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "crates/oq-core/Cargo.toml",
  "crates/oq-core/src/document.rs",
  "crates/oq-core/src/edit.rs",
  "crates/oq-core/src/expression.rs",
  "crates/oq-core/src/lib.rs",
  "crates/oq-core/src/schema.rs",
  "crates/oq-wasm/Cargo.toml",
  "crates/oq-wasm/src/lib.rs",
  "crates/oq/Cargo.toml",
  "crates/oq/src/help.txt",
  "crates/oq/src/lib.rs",
  "crates/oq/src/main.rs",
];
export const commonFiles = [
  "bindings/js/dist/index.js",
  "bindings/js/dist/index.d.ts",
  "README.md",
  "LICENSE",
  "docs/contract.md",
];
export const sourceScripts = [
  "scripts/build-bindings.mjs",
  "scripts/build-wasm.mjs",
  "scripts/package-layout.mjs",
  "scripts/prepare-package.mjs",
  "scripts/install-bindings.mjs",
  "scripts/check-source-publish.mjs",
];
export const sourceFiles = [
  ...commonFiles,
  ...sourceScripts,
  ...rustInputs.map((path) => `${rustDirectory}/${path}`),
];
export const prebuiltFiles = [...commonFiles, "bindings/js/dist/oq.wasm"];

function regular(root, path) {
  const file = join(root, path);
  if (!existsSync(file) || !lstatSync(file).isFile())
    throw new Error(`Incomplete package layout: expected regular file ${path}`);
}
function exactFiles(manifest, expected) {
  if (JSON.stringify(manifest.files) !== JSON.stringify(expected))
    throw new Error(
      "Package files must match the exact declared layout allowlist",
    );
}
export function readManifest(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/** Generated staging/WASM never change a source package's ownership classification. */
export function packageLayout(root) {
  const manifest = readManifest(root);
  const declaration = manifest.oqPackage;
  if (
    !declaration ||
    declaration.format !== 1 ||
    Object.keys(declaration).some((key) => !["format", "kind"].includes(key))
  )
    throw new Error("Unknown or missing oq package layout declaration");
  const cargo = existsSync(join(root, "Cargo.toml"));
  const crates = existsSync(join(root, "crates"));
  const checkout = existsSync(join(root, "oq-checkout.json"));
  if (declaration.kind === "prebuilt") {
    exactFiles(manifest, prebuiltFiles);
    if (
      checkout ||
      cargo ||
      crates ||
      existsSync(join(root, rustDirectory)) ||
      sourceScripts.some((path) => existsSync(join(root, path))) ||
      Object.keys(manifest.scripts ?? {}).length ||
      Object.keys(manifest.devDependencies ?? {}).length
    )
      throw new Error(
        "Prebuilt package must not contain source inputs or lifecycle hooks",
      );
    for (const path of prebuiltFiles) regular(root, path);
    if (
      !WebAssembly.validate(
        readFileSync(join(root, "bindings/js/dist/oq.wasm")),
      )
    )
      throw new Error("Prebuilt package contains invalid WebAssembly");
    return "prebuilt";
  }
  if (declaration.kind !== "source")
    throw new Error("Unknown oq package layout kind");
  exactFiles(manifest, sourceFiles);
  for (const [name, command] of Object.entries({
    build: "node scripts/build-bindings.mjs",
    prepare: "node scripts/prepare-package.mjs",
    postinstall: "node scripts/install-bindings.mjs",
    prepublishOnly: "node scripts/check-source-publish.mjs",
  }))
    if (manifest.scripts?.[name] !== command)
      throw new Error(`Inconsistent source lifecycle: ${name}`);
  for (const path of sourceScripts) regular(root, path);
  if (checkout) {
    regular(root, "oq-checkout.json");
    if (
      JSON.stringify(
        JSON.parse(readFileSync(join(root, "oq-checkout.json"), "utf8")),
      ) !== '{"format":1}'
    )
      throw new Error("Unknown source checkout owner marker");
    if (!cargo || !crates)
      throw new Error("Incomplete root Cargo workspace layout");
    for (const path of rustInputs) regular(root, path);
    return "checkout";
  }
  if (cargo || crates)
    throw new Error("Packed source must not contain a root Cargo workspace");
  for (const path of [
    ...commonFiles,
    ...rustInputs.map((path) => `${rustDirectory}/${path}`),
  ])
    regular(root, path);
  return "source";
}

/** Stage already-built bindings under a manifest with no source lifecycle. */
export function stagePrebuilt(root, destination) {
  if (packageLayout(root) !== "checkout")
    throw new Error("Release staging requires a source checkout");
  const source = readManifest(root);
  const manifest = {};
  for (const key of [
    "name",
    "version",
    "description",
    "license",
    "type",
    "exports",
    "repository",
  ])
    if (source[key] !== undefined) manifest[key] = source[key];
  manifest.oqPackage = { format: 1, kind: "prebuilt" };
  manifest.files = prebuiltFiles;
  mkdirSync(destination, { recursive: true });
  for (const path of prebuiltFiles) {
    regular(root, path);
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    copyFileSync(join(root, path), join(destination, path));
  }
  writeFileSync(
    join(destination, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  packageLayout(destination);
}
