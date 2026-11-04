/** Build once, then pack an explicit prebuilt manifest with no installation build hook. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBindings } from "./build-bindings.mjs";
import { stagePrebuilt } from "./package-layout.mjs";
import { run } from "./build-wasm.mjs";

export function packRelease(root, destination) {
  buildBindings(root);
  mkdirSync(join(root, ".result"), { recursive: true });
  mkdirSync(destination, { recursive: true });
  const staged = mkdtempSync(join(root, ".result/prebuilt-package-"));
  try {
    stagePrebuilt(root, staged);
    const windows = process.platform === "win32";
    run(
      windows ? process.execPath : "npm",
      [
        ...(windows
          ? [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
          : []),
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        destination,
      ],
      { cwd: staged },
    );
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  packRelease(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    resolve(process.argv[2] ?? ".result"),
  );
