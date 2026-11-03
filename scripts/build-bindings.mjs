import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("cargo", [
  "build",
  "--locked",
  "--release",
  "-p",
  "oq-wasm",
  "--target",
  "wasm32-unknown-unknown",
]);
run(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  "-p",
  "bindings/js/tsconfig.json",
]);
mkdirSync(resolve(root, "bindings/js/dist"), { recursive: true });
const target = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : resolve(root, "target");
copyFileSync(
  resolve(target, "wasm32-unknown-unknown/release/oq_wasm.wasm"),
  resolve(root, "bindings/js/dist/oq.wasm"),
);
