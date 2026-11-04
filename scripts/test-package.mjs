// Install the official prebuilt archive with default scripts and no Rust on PATH.
// Real npm, filesystem, exported JS/declarations, and WASM; no installation mocks.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".result", { recursive: true });
const root = process.cwd();
const temporary = mkdtempSync(resolve(".result/npm-consumer-"));
const windows = process.platform === "win32";
const npm = windows
  ? process.execPath
  : process.env.PATH.split(delimiter)
      .map((directory) => join(directory, "npm"))
      .find(existsSync);
assert.ok(npm, "npm must be available in the development environment");
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(
    command === "npm" ? npm : command,
    command === "npm" && windows
      ? [
          join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
          ...args,
        ]
      : args,
    {
      cwd,
      encoding: "utf8",
      env,
    },
  );
  console.log(JSON.stringify({ command, args, cwd, status: result.status }));
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed`);
  return result.stdout;
}
try {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const archive = resolve(".result", `agent-harbor-oq-${version}.tgz`);
  assert.ok(
    existsSync(archive),
    "run just package to build the prebuilt archive",
  );
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  const runtimeBin = join(temporary, "runtime-bin");
  mkdirSync(runtimeBin);
  if (!windows) symlinkSync(process.execPath, join(runtimeBin, "node"));
  const runtimeEnvironment = {
    ...process.env,
    PATH: windows ? dirname(process.execPath) : runtimeBin,
  };
  for (const compiler of ["cargo", "rustc"])
    assert.equal(
      spawnSync(compiler, ["--version"], { env: runtimeEnvironment }).error
        ?.code,
      "ENOENT",
      `${compiler} must be unavailable`,
    );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", archive],
    consumer,
    runtimeEnvironment,
  );
  const installed = join(consumer, "node_modules/@agent-harbor/oq");
  const manifest = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.oqPackage, { format: 1, kind: "prebuilt" });
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(existsSync(join(installed, "bindings/js/rust")), false);
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
    const source = '* =Title=\\nBody /text/.\\n- [x] Read [[file:guide.org]]\\n| | value ||\\n';
    const section = oq.parse(source).children[0];
    assert.equal(section.title_plain, 'Title');
    assert.equal(section.items[0].checkbox, 'X');
    assert.equal(section.items[0].text_plain, 'Read file:guide.org');
    assert.deepEqual(section.paragraphs, [{ text: 'Body /text/.\\n', plain: 'Body text.\\n', line: 2, start: 10, end: 23 }]);
    assert.deepEqual(section.tables[0][0].cells, ['', 'value', '']);
    assert.equal(oq.set(source, '.'), source);
  `,
    ],
    consumer,
    runtimeEnvironment,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
