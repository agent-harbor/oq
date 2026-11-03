import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeTarget } from "./native-target.mjs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = /\[workspace.package\]\s*version = "([^"]+)"/.exec(
  readFileSync("Cargo.toml", "utf8"),
)?.[1];
if (pkg.version !== version) throw new Error("Cargo and npm versions differ");
const target = process.env.CARGO_TARGET_DIR
  ? resolve(process.env.CARGO_TARGET_DIR)
  : resolve("target");
const stem = `oq-v${version}-${process.platform}-${process.arch}`;
const directory = resolve(".result/dist", stem);
mkdirSync(directory, { recursive: true });
copyFileSync(
  join(
    target,
    nativeTarget(),
    "release",
    process.platform === "win32" ? "oq.exe" : "oq",
  ),
  join(directory, process.platform === "win32" ? "oq.exe" : "oq"),
);
for (const file of ["README.md", "LICENSE"])
  copyFileSync(file, join(directory, file));
const archive = resolve(".result/dist", `${stem}.tar.gz`);
const result = spawnSync("tar", ["-czf", archive, "-C", ".result/dist", stem], {
  stdio: "inherit",
});
if (result.status !== 0) throw new Error("tar failed");
writeFileSync(
  `${archive}.sha256`,
  `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${stem}.tar.gz\n`,
);
console.log(`Created ${archive}`);
