import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const version = /\[workspace.package\]\s*version = "([^"]+)"/.exec(
  readFileSync("Cargo.toml", "utf8"),
)?.[1];
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}`)
  throw new Error("Release tag must match the workspace version");
for (const name of ["CARGO_REGISTRY_TOKEN", "NODE_AUTH_TOKEN", "GH_TOKEN"]) {
  if (!process.env[name])
    throw new Error(`Missing publishing credential ${name}`);
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed`);
}
run("git", ["merge-base", "--is-ancestor", "HEAD", "origin/stable"]);
const directory = ".result/release";
const artifacts = readdirSync(directory)
  .filter((f) => /\.(tar\.gz|tgz|sha256|asc)$/.test(f))
  .map((f) => join(directory, f));
const npm = artifacts.find((f) => f.endsWith(".tgz"));
if (!npm || !artifacts.some((f) => f.endsWith(".tar.gz")))
  throw new Error("Native and WASM release archives are required");
for (const artifact of artifacts.filter((f) => /\.(tar\.gz|tgz)$/.test(f))) {
  if (
    !artifacts.includes(`${artifact}.asc`) ||
    !artifacts.includes(`${artifact}.sha256.asc`)
  )
    throw new Error(`Missing signatures for ${artifact}`);
}
run("cargo", ["publish", "--locked", "-p", "oq-core"]);
run("npm", ["publish", "--access", "public", npm]);
writeFileSync(
  ".result/release-notes.txt",
  `oq ${version}\n\nNative Org document tools and the shared Rust/WebAssembly package. SHA-256 checksums and detached signatures accompany the archives.\n`,
);
run("gh", [
  "release",
  "create",
  tag,
  "--verify-tag",
  "--title",
  `oq ${version}`,
  "--notes-file",
  ".result/release-notes.txt",
  ...artifacts,
]);
