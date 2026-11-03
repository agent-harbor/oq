// Update a real isolated Cargo/npm workspace, including rollback after failure.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".result", { recursive: true });
const temporary = mkdtempSync(resolve(".result/version-test-"));
const paths = [
  "Cargo.toml",
  "Cargo.lock",
  "crates/oq/Cargo.toml",
  "package.json",
  "package-lock.json",
  "tests/schema-consumer/Cargo.lock",
];
function run(version) {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/bump-version.mjs"), version],
    { cwd: temporary, encoding: "utf8" },
  );
  console.log(
    JSON.stringify({
      version,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  if (result.error) throw result.error;
  return result;
}
try {
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "crates",
    "package.json",
    "package-lock.json",
    "tests/schema-consumer",
  ])
    cpSync(path, join(temporary, path), { recursive: true });
  assert.equal(run("1.2.3").status, 0);
  assert.match(
    readFileSync(join(temporary, "Cargo.toml"), "utf8"),
    /\[workspace.package\]\s*version = "1.2.3"/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(temporary, "package.json"), "utf8")).version,
    "1.2.3",
  );
  assert.equal(
    JSON.parse(readFileSync(join(temporary, "package-lock.json"), "utf8"))
      .packages[""].version,
    "1.2.3",
  );
  for (const name of ["oq", "oq-core", "oq-wasm"])
    assert.match(
      readFileSync(join(temporary, "Cargo.lock"), "utf8"),
      new RegExp(`name = "${name}"\\nversion = "1.2.3"`),
    );
  assert.match(
    readFileSync(join(temporary, "tests/schema-consumer/Cargo.lock"), "utf8"),
    /name = "oq-core"\nversion = "1.2.3"/,
  );
  const cargo = join(temporary, "Cargo.toml");
  writeFileSync(
    cargo,
    readFileSync(cargo, "utf8").replace(
      "members = [",
      'members = ["missing-member",',
    ),
  );
  const before = new Map(
    paths.map((path) => [path, readFileSync(join(temporary, path))]),
  );
  assert.notEqual(run("2.0.0").status, 0);
  for (const [path, bytes] of before)
    assert.deepEqual(
      readFileSync(join(temporary, path)),
      bytes,
      `rollback of ${path}`,
    );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
