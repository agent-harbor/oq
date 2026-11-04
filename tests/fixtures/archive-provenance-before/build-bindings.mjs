import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    throw new Error(`${command} failed (${result.signal ?? result.status})`);
  }
  return result;
}

// Cargo's timestamp freshness checks can reuse a different same-version source
// preparation in a shared target. A fresh invocation namespace makes only this
// build's outputs eligible, without deleting or repairing the caller's cache.
const target = realpathSync(mkdtempSync(join(tmpdir(), "oq-bindings-")));
try {
  const result = run(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "-p",
      "oq-wasm",
      "--target",
      "wasm32-unknown-unknown",
      "--target-dir",
      target,
      "--message-format=json-render-diagnostics",
    ],
    {
      env: {
        ...process.env,
        CARGO_TARGET_DIR: target,
        CARGO_BUILD_BUILD_DIR: join(target, "build"),
      },
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const manifest = realpathSync(resolve(root, "crates/oq-wasm/Cargo.toml"));
  const messages = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  for (const message of messages)
    if (message.reason === "compiler-message" && message.message.rendered)
      process.stderr.write(message.message.rendered);
  const artifacts = messages
    .filter(
      (message) =>
        message.reason === "compiler-artifact" &&
        realpathSync(message.manifest_path) === manifest &&
        message.target.name === "oq_wasm" &&
        message.target.crate_types.includes("cdylib"),
    )
    .flatMap((message) =>
      message.filenames.filter((file) => file.endsWith(".wasm")),
    );
  if (artifacts.length !== 1)
    throw new Error(
      `Expected one oq-wasm artifact, received ${artifacts.length}`,
    );
  const artifact = realpathSync(artifacts[0]);
  const path = relative(target, artifact);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error(
      "Cargo reported an artifact outside the owned build directory",
    );
  const wasm = readFileSync(artifact);
  if (!WebAssembly.validate(wasm))
    throw new Error("Cargo reported an invalid WebAssembly module");
  run(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "bindings/js/tsconfig.json",
  ]);
  mkdirSync(resolve(root, "bindings/js/dist"), { recursive: true });
  writeFileSync(resolve(root, "bindings/js/dist/oq.wasm"), wasm);
} finally {
  rmSync(target, { recursive: true, force: true });
}
