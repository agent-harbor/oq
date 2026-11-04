/** Source checkout bootstrap skips Rust; installed source always rebuilds it. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageLayout, rustDirectory } from "./package-layout.mjs";
import { buildWasm } from "./build-wasm.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layout = packageLayout(root);
if (layout === "checkout") {
  console.log("oq: source checkout bootstrap; Rust builds use npm run build");
} else if (layout === "source") {
  buildWasm(join(root, rustDirectory), join(root, "bindings/js/dist/oq.wasm"));
} else {
  throw new Error("Prebuilt packages must not have a source installation hook");
}
