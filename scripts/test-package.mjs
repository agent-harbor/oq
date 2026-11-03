import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".result", { recursive: true });
const root = process.cwd();
const temporary = mkdtempSync(resolve(".result/npm-consumer-"));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && command === "npm",
  });
  console.log(JSON.stringify({ command, args, cwd, status: result.status }));
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed`);
  return result.stdout;
}
try {
  const packed = JSON.parse(
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporary,
    ]),
  );
  const archive = join(temporary, packed[0].filename);
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    consumer,
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { createOq } from '@agent-harbor/oq';
    const oq = await createOq(readFileSync(new URL(import.meta.resolve('@agent-harbor/oq/oq.wasm'))));
    assert.deepEqual(oq.query('* Consumer 雪\\n', '.children[].title'), ['Consumer 雪']);
    assert.equal(oq.set('* A\\n', '.children[0].title="B"'), '* B\\n');
  `,
    ],
    consumer,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
