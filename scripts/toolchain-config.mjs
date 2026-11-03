import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const channel = /^channel\s*=\s*"([^"]+)"/m.exec(
  readFileSync("rust-toolchain.toml", "utf8"),
)?.[1];
const node = readFileSync(".node-version", "utf8").trim();
if (!channel || !/^\d+\.\d+\.\d+$/.test(channel))
  throw new Error("Rust toolchain must be pinned to an exact release");
if (process.argv.includes("--check")) {
  const result = spawnSync("rustc", ["--version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout.startsWith(`rustc ${channel} `))
    throw new Error(
      `Expected Rust ${channel}; got ${result.stdout}${result.stderr}`,
    );
  if (process.versions.node !== node)
    throw new Error(`Expected Node ${node}; got ${process.versions.node}`);
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `channel=${channel}\n`);
console.log(JSON.stringify({ channel, node }));
