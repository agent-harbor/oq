import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? ""))
  throw new Error("expected a semantic version");
const manifest = readFileSync("Cargo.toml", "utf8");
const previous = /\[workspace.package\]\s*version = "([^"]+)"/.exec(
  manifest,
)?.[1];
if (!previous) throw new Error("missing workspace package version");
const paths = [
  "Cargo.toml",
  "Cargo.lock",
  "crates/oq/Cargo.toml",
  "package.json",
  "package-lock.json",
  "tests/schema-consumer/Cargo.lock",
];
const snapshots = new Map(paths.map((path) => [path, readFileSync(path)]));
try {
  writeFileSync(
    "Cargo.toml",
    manifest.replace(`version = "${previous}"`, `version = "${version}"`),
  );
  writeFileSync(
    "crates/oq/Cargo.toml",
    readFileSync("crates/oq/Cargo.toml", "utf8").replaceAll(
      `version = "${previous}"`,
      `version = "${version}"`,
    ),
  );
  writeFileSync(
    "Cargo.toml",
    readFileSync("Cargo.toml", "utf8").replaceAll(
      `version = "${previous}"`,
      `version = "${version}"`,
    ),
  );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  pkg.version = version;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [command, args] of [
    ["cargo", ["update", "--workspace", "--offline"]],
    [
      "cargo",
      [
        "update",
        "--workspace",
        "--offline",
        "--manifest-path",
        "tests/schema-consumer/Cargo.toml",
      ],
    ],
    [
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
      ],
    ],
  ]) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed`);
  }
} catch (error) {
  for (const [path, bytes] of snapshots) writeFileSync(path, bytes);
  throw error;
}
