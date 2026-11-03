// Restore jaq's process-exiting adapter only in an isolated source copy. The
// real CLI regression test must fail with exit 0 versus expected exit 2.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
mkdirSync(".result", { recursive: true });
const temporary = mkdtempSync(resolve(".result/halt-mutation-"));
try {
  for (const file of ["Cargo.toml", "Cargo.lock", "crates", "tests"])
    cpSync(file, join(temporary, file), { recursive: true });
  const path = join(temporary, "crates/oq-core/src/expression.rs");
  const source = readFileSync(path, "utf8");
  const branch =
    /Err\(exception\) => \{[\s\S]*?return Err\(Error::Expression\(message\)\);\s*\}/;
  assert.equal(
    (source.match(new RegExp(branch.source, "g")) ?? []).length,
    1,
    "expected one explicit exception handler",
  );
  writeFileSync(
    path,
    source.replace(
      branch,
      `Err(exception) => {
    let result: Result<Val, jaq_core::Error<Val>> = jaq_core::unwrap_valr(Err(exception));
    return Err(Error::Expression(result.unwrap_err().to_string()));
  }`,
    ),
  );
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--locked",
      "-p",
      "oq",
      "--test",
      "cli",
      "cli_queries_and_atomic_edits_retain_permissions_and_reject_errors",
      "--",
      "--exact",
    ],
    {
      cwd: temporary,
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: join(temporary, "target") },
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  assert.equal(result.status, 101, "mutated CLI regression test must fail");
  assert.match(
    result.stdout,
    /left: Some\(0\)[\s\S]*right: Some\(2\)/,
    "failure must specifically expose the forbidden successful halt",
  );
  const logs = join(temporary, ".result/logs");
  mkdirSync(".result/logs", { recursive: true });
  for (const file of readdirSync(logs)) {
    const target = resolve(
      ".result/logs",
      `halt-mutation-${randomUUID()}-${basename(file)}`,
    );
    cpSync(join(logs, file), target);
    console.log(`Preserved mutated subprocess output: ${target}`);
  }
  console.log(
    "Falsifying mutation proved the CLI exit-code guard rejects jaq's exiting adapter",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
