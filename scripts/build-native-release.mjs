import { spawnSync } from "node:child_process";
import { nativeTarget } from "./native-target.mjs";
const env = { ...process.env };
if (process.platform === "win32") {
  const flags =
    env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ??
    env.RUSTFLAGS?.trim().split(/\s+/).filter(Boolean) ??
    [];
  env.CARGO_ENCODED_RUSTFLAGS = [
    ...flags,
    "-C",
    "target-feature=+crt-static",
  ].join("\x1f");
}
const result = spawnSync(
  "cargo",
  ["build", "--locked", "--release", "-p", "oq", "--target", nativeTarget()],
  { env, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
