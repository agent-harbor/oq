/** Explicit contributor build and the installed-source rebuild share one WASM producer. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWasm } from "./build-wasm.mjs";
import { packageLayout, rustDirectory } from "./package-layout.mjs";
import { preparePackage } from "./prepare-package.mjs";

export function buildBindings(root) {
  const layout = packageLayout(root);
  if (layout === "prebuilt")
    throw new Error("Prebuilt packages have no Rust build inputs");
  if (layout === "checkout") preparePackage(root);
  buildWasm(
    layout === "checkout" ? root : join(root, rustDirectory),
    join(root, "bindings/js/dist/oq.wasm"),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  buildBindings(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
