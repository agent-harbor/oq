// Execute the exact pinned shared action, not a local substitute for its logic.
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const source = process.env.OQ_WORKFLOW_GUARD_SOURCE;
if (!source)
  throw new Error(
    "OQ_WORKFLOW_GUARD_SOURCE is required; enter the pinned Nix development shell",
  );
const action = join(source, "assert-workflow-triggers/index.cjs");
if (!existsSync(action))
  throw new Error(`Missing canonical workflow guard: ${action}`);
const lock = JSON.parse(readFileSync("flake.lock", "utf8"));
const revision =
  lock.nodes[lock.nodes.root.inputs["workflow-guard-source"]].locked.rev;
for (const path of [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
])
  assert.ok(
    readFileSync(path, "utf8").includes(
      `metacraft-labs/metacraft-github-actions/assert-workflow-triggers@${revision}`,
    ),
    `${path} must use the declared immutable guard revision`,
  );
function run(root, mainline) {
  const result = spawnSync(process.execPath, [action], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: root,
      INPUT_MAINLINE: mainline,
      INPUT_WORKFLOWS: "",
    },
  });
  console.log(
    JSON.stringify({
      action,
      workspace: root,
      mainline,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  if (result.error) throw result.error;
  return result;
}
const actual = run(process.cwd(), "");
assert.equal(
  actual.status,
  0,
  "the canonical guard must detect origin/dev and accept current workflow filters",
);
assert.match(actual.stdout, /2 workflow\(s\) name the mainline `dev`/);
mkdirSync(".result", { recursive: true });
const temporary = mkdtempSync(resolve(".result/workflow-guard-"));
try {
  const workflows = join(temporary, ".github/workflows");
  mkdirSync(workflows, { recursive: true });
  for (const name of ["ci.yml", "release.yml"])
    writeFileSync(
      join(workflows, name),
      readFileSync(`.github/workflows/${name}`),
    );
  assert.equal(run(temporary, "dev").status, 0);
  const path = join(workflows, "ci.yml");
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes("branches: [dev, stable]"));
  writeFileSync(
    path,
    text.replaceAll("branches: [dev, stable]", "branches: [agents]"),
  );
  const rejected = run(temporary, "dev");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /does not name the mainline `dev`/);
  const empty = join(temporary, "missing");
  mkdirSync(empty);
  const missing = run(empty, "dev");
  assert.equal(missing.status, 2);
  assert.match(
    missing.stderr,
    /could not enumerate workflow files|no workflow files found/,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
