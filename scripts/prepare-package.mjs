/** Prepare immutable package inputs without putting compiler output in a source archive. */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageLayout, rustDirectory, rustInputs } from "./package-layout.mjs";
import { run } from "./build-wasm.mjs";

export function preparePackage(root) {
  const layout = packageLayout(root);
  if (layout === "source") return;
  if (layout !== "checkout")
    throw new Error("Source preparation requires a source package");
  run(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      "bindings/js/tsconfig.json",
    ],
    { cwd: root },
  );
  const destination = join(root, rustDirectory);
  mkdirSync(dirname(destination), { recursive: true });
  const staged = mkdtempSync(join(dirname(destination), ".oq-source-"));
  try {
    for (const path of rustInputs) {
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      copyFileSync(join(root, path), join(staged, path));
    }
    rmSync(destination, { recursive: true, force: true });
    renameSync(staged, destination);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  preparePackage(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
