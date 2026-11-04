/**
 * Real source-preparation/installed-package integration regression; no mocked
 * Cargo, compiler, engine, npm, or filesystem. The frozen historical document
 * module is compiled into the older same-version engine to warm a foreign
 * target. Old mtimes and a shared transparent caller wrapper reproduce Cargo's
 * timestamp-based reuse across source preparations. The controlled wrapper is
 * compiled as a native executable for portability; it only forwards rustc and
 * records that caller configuration remains in use. An inherited workspace
 * wrapper can instead exercise an actual caller's compiler environment.
 *
 * Two newer preparations run npm's real prepare lifecycle, install the packed
 * archive in isolated consumers, and exercise the actual exported WASM and
 * declarations against hard-coded expectations and a fresh native CLI. Relative
 * and absolute inherited targets, paths with spaces, repeat preparation, exact
 * installed bytes, and unchanged foreign cache bytes are checked. Passing
 * --producer <script> replaces only the copied producer for a falsifying run:
 * the original producer must fail the newer runtime assertions after compiling
 * and packaging successfully, rather than passing because compilation failed.
 */
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { stagePrebuilt } from "./package-layout.mjs";

const root = process.cwd();
const producerIndex = process.argv.indexOf("--producer");
const producer =
  producerIndex < 0 ? null : resolve(process.argv[producerIndex + 1]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source =
  "* =Title= 雪\r\nBody /text/.\r\n- [x] Read [[file:guide.org]]\r\n| | alpha || gamma |   | omega |\r\n";
const fixture = readFileSync(
  "tests/fixtures/build-provenance/document-before.rs",
);
assert.equal(
  sha256(fixture),
  "0970368a5537a31358f409065f933e013c6dea9b65c2161e43fbc7251f79f1f8",
  "the historical engine fixture must remain byte-for-byte unchanged",
);
mkdirSync(".result", { recursive: true });
const temporary = mkdtempSync(resolve(".result/build provenance "));
const foreign = join(temporary, "foreign target");
const environment = {
  ...process.env,
  CARGO_TARGET_DIR: foreign,
  CARGO_BUILD_BUILD_DIR: join(foreign, "build"),
};
mkdirSync(".result/logs", { recursive: true });

function run(command, args, cwd = root, env = environment, expectedStatus = 0) {
  // The Windows Node distribution supplies npm's JS entry point next to node.
  // Invoke it directly so paths with spaces retain argv boundaries through npm.
  const windowsNpm = process.platform === "win32" && command === "npm";
  const result = spawnSync(
    windowsNpm ? process.execPath : command,
    windowsNpm
      ? [
          join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
          ...args,
        ]
      : args,
    {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const subprocessLog = resolve(
    ".result/logs",
    `build-provenance-subprocess-${randomUUID()}.log`,
  );
  const invocation = JSON.stringify({
    command,
    args,
    cwd,
    status: result.status,
  });
  writeFileSync(
    subprocessLog,
    `${invocation}\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.stack ?? ""}`,
  );
  console.log(
    `${invocation} (${subprocessLog}, ${statSync(subprocessLog).size} bytes)`,
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expectedStatus,
    `${command} must exit ${expectedStatus}`,
  );
  if (expectedStatus !== 0)
    assert.match(
      result.stderr,
      /missing compiler/,
      "failure must come from the intentionally unavailable compiler",
    );
  return result.stdout;
}

function normalize(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) normalize(path);
    utimesSync(path, new Date("2000-01-01Z"), new Date("2000-01-01Z"));
  }
}

function preparation(name, older = false) {
  const dir = join(temporary, name);
  mkdirSync(dir);
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "oq-checkout.json",
    "crates",
    "bindings/js/src",
    "bindings/js/tsconfig.json",
    "scripts",
    "package.json",
    "package-lock.json",
    "LICENSE",
    "README.md",
    "docs/contract.md",
  ])
    cpSync(path, join(dir, path), { recursive: true });
  if (older)
    writeFileSync(join(dir, "crates/oq-core/src/document.rs"), fixture);
  if (producer) cpSync(producer, join(dir, "scripts/build-bindings.mjs"));
  normalize(dir);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version,
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  );
  return dir;
}

function snapshot(dir, prefix = "") {
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const name = `${prefix}${entry.name}`;
      const path = join(dir, entry.name);
      return entry.isDirectory()
        ? Object.entries(snapshot(path, `${name}/`))
        : [[name, sha256(readFileSync(path))]];
    }),
  );
}

function checkCurrent(oq) {
  const heading = oq.parse(source).children[0];
  assert.equal(
    heading.items[0].checkbox,
    "X",
    "selected engine recognizes [x]",
  );
  assert.equal(heading.title, "=Title= 雪");
  assert.equal(heading.title_plain, "Title 雪");
  assert.equal(heading.items[0].text, "Read [[file:guide.org]]");
  assert.equal(heading.items[0].text_plain, "Read file:guide.org");
  assert.deepEqual(heading.tables[0][0].cells, [
    "",
    "alpha",
    "",
    "gamma",
    "",
    "omega",
  ]);
  assert.deepEqual(heading.paragraphs, [
    {
      text: "Body /text/.\r\n",
      plain: "Body text.\r\n",
      line: 2,
      start: 15,
      end: 29,
    },
  ]);
  assert.equal(oq.set(source, "."), source);
  assert.equal(
    oq.set(source, '.children[0].tables[0][0].cells[2] = "filled"'),
    source.replace("alpha ||", "alpha |filled|"),
  );
  assert.equal(
    oq.set(source, '.children[0].title = "Changed"'),
    source.replace("=Title= 雪", "Changed"),
  );
  assert.throws(() => oq.set(source, '.children[0].title_plain = "Changed"'));
  return heading;
}

try {
  run("cargo", ["--version"]);
  run("rustc", ["--version"]);
  if (!environment.RUSTC_WORKSPACE_WRAPPER) {
    const wrapperSource = join(temporary, "caller wrapper.rs");
    const wrapper = join(
      temporary,
      `caller wrapper${process.platform === "win32" ? ".exe" : ""}`,
    );
    writeFileSync(
      wrapperSource,
      `
use std::{env, fs::OpenOptions, io::Write, process::{Command, exit}};
fn main() {
    let mut args = env::args_os().skip(1);
    let compiler = args.next().expect("rustc command");
    if let Some(path) = env::var_os("OQ_TEST_WRAPPER_LOG") {
        writeln!(OpenOptions::new().create(true).append(true).open(path).unwrap(), "rustc").unwrap();
    }
    exit(Command::new(compiler).args(args).status().expect("rustc execution").code().unwrap_or(1));
}
`,
    );
    run("rustc", [
      "--crate-name",
      "caller_wrapper",
      wrapperSource,
      "-o",
      wrapper,
    ]);
    environment.RUSTC_WORKSPACE_WRAPPER = wrapper;
    environment.OQ_TEST_WRAPPER_LOG = join(temporary, "wrapper calls.log");
  }
  const older = preparation("older source", true);
  // Seed via the original Cargo boundary, even after the producer has been fixed.
  run(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "-p",
      "oq-wasm",
      "--target",
      "wasm32-unknown-unknown",
    ],
    older,
  );
  const olderWasm = readFileSync(
    join(foreign, "wasm32-unknown-unknown/release/oq_wasm.wasm"),
  );
  // Compile the actual transport without invoking the newer producer for this seed.
  run(
    process.execPath,
    [
      join(older, "node_modules/typescript/bin/tsc"),
      "-p",
      "bindings/js/tsconfig.json",
    ],
    older,
  );
  const { createOq } = await import(
    pathToFileURL(join(older, "bindings/js/dist/index.js"))
  );
  const oldEngine = await createOq(olderWasm);
  const oldHeading = oldEngine.parse(source).children[0];
  assert.equal(oldHeading.items[0].checkbox, null);
  assert.equal(oldHeading.title_plain, undefined);
  assert.equal(oldHeading.items[0].text_plain, undefined);
  assert.equal(oldHeading.paragraphs, undefined);
  assert.notDeepEqual(oldHeading.tables[0][0].cells, [
    "",
    "alpha",
    "",
    "gamma",
    "",
    "omega",
  ]);
  console.log(`Older runtime confirmed: ${sha256(olderWasm)}`);
  const before = snapshot(foreign);
  const nativeTarget = join(temporary, "native reference");
  let nativeHeading;
  for (const [index, inheritedTarget] of [
    "../foreign target",
    foreign,
  ].entries()) {
    const selected = preparation(`selected source ${index}`);
    const ownedTemporary = join(temporary, `producer temp ${index}`);
    mkdirSync(ownedTemporary);
    const env = {
      ...environment,
      CARGO_TARGET_DIR: inheritedTarget,
      TMPDIR: ownedTemporary,
      TMP: ownedTemporary,
      TEMP: ownedTemporary,
    };
    if (index === 0) {
      run(
        "cargo",
        ["build", "--locked", "-p", "oq", "--target-dir", nativeTarget],
        selected,
        {
          ...environment,
          CARGO_BUILD_BUILD_DIR: join(nativeTarget, "build"),
        },
      );
      const cli = join(
        nativeTarget,
        "debug",
        `oq${process.platform === "win32" ? ".exe" : ""}`,
      );
      const input = join(temporary, "input document.org");
      writeFileSync(input, source);
      nativeHeading = JSON.parse(run(cli, ["query", ".children[0]", input]));
      checkCurrent({
        parse: () => ({ children: [nativeHeading] }),
        set: (text, expression) => run(cli, ["set", expression, input]),
      });
    }
    const wrapperCalls = environment.OQ_TEST_WRAPPER_LOG
      ? readFileSync(environment.OQ_TEST_WRAPPER_LOG, "utf8").length
      : null;
    // Source npm pack deliberately excludes WASM. Exercise the explicit real
    // build and the shared prebuilt staging path so the historical producer
    // counterfactual still packages its successful (but stale) compiler output.
    run("npm", ["run", "build"], selected, env);
    const prebuilt = join(temporary, `prebuilt stage ${index}`);
    stagePrebuilt(selected, prebuilt);
    const packed = run(
      "npm",
      ["pack", "--json", "--pack-destination", temporary],
      prebuilt,
      env,
    );
    assert.deepEqual(
      readdirSync(ownedTemporary).filter((name) =>
        name.startsWith("oq-bindings-"),
      ),
      [],
      "producer must reclaim its temporary build",
    );
    // npm prepare output can precede npm pack's final JSON value.
    const jsonStart = packed.search(/^\s*\[\s*$/m);
    assert.notEqual(jsonStart, -1, "npm pack must report its archive as JSON");
    const files = JSON.parse(packed.slice(jsonStart));
    const archive = join(temporary, files[0].filename);
    const preparedWasm = readFileSync(
      join(selected, "bindings/js/dist/oq.wasm"),
    );
    const consumer = join(temporary, `installed consumer ${index}`);
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
    const installed = join(consumer, "node_modules/@agent-harbor/oq");
    for (const file of ["index.js", "index.d.ts", "oq.wasm"])
      assert.deepEqual(
        readFileSync(join(installed, "bindings/js/dist", file)),
        readFileSync(join(selected, "bindings/js/dist", file)),
      );
    const declarations = readFileSync(
      join(installed, "bindings/js/dist/index.d.ts"),
      "utf8",
    );
    for (const field of ["title_plain", "text_plain", "paragraphs"])
      assert.match(declarations, new RegExp(`readonly ${field}[:?]`));
    writeFileSync(
      join(consumer, "consumer.ts"),
      `import {createOq} from '@agent-harbor/oq';
const oq = await createOq(new Uint8Array());
const heading = oq.parse('* Example\\n').children[0];
heading.title_plain satisfies string;
heading.items[0].text_plain satisfies string;
heading.paragraphs[0].plain satisfies string;
// @ts-expect-error display projections are read-only
heading.title_plain = 'changed';
// @ts-expect-error display projections are read-only
heading.items[0].text_plain = 'changed';
// @ts-expect-error direct prose is read-only
heading.paragraphs.push(heading.paragraphs[0]);
`,
    );
    run(
      process.execPath,
      [
        join(selected, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "consumer.ts",
      ],
      consumer,
    );
    // Resolve through public exports from the installed consumer, not a source import.
    const probe = join(consumer, "probe.mjs");
    writeFileSync(
      probe,
      `import {createOq} from '@agent-harbor/oq'; import {readFileSync} from 'node:fs';
const bytes = readFileSync(new URL(import.meta.resolve('@agent-harbor/oq/oq.wasm')));
const oq = await createOq(bytes);
console.log(JSON.stringify({document:oq.parse(${JSON.stringify(source)}), noop:oq.set(${JSON.stringify(source)},'.')}));`,
    );
    const observed = JSON.parse(run(process.execPath, [probe], consumer));
    assert.equal(observed.noop, source);
    const { createOq: installedCreateOq } = await import(
      pathToFileURL(join(installed, "bindings/js/dist/index.js"))
    );
    const installedEngine = await installedCreateOq(
      readFileSync(join(installed, "bindings/js/dist/oq.wasm")),
    );
    const heading = checkCurrent(installedEngine);
    if (wrapperCalls !== null)
      assert.ok(
        readFileSync(environment.OQ_TEST_WRAPPER_LOG, "utf8").length >
          wrapperCalls,
        "producer must preserve the caller's compiler wrapper",
      );
    assert.notEqual(
      sha256(preparedWasm),
      sha256(olderWasm),
      "new engine bytes differ from old engine",
    );
    assert.deepEqual(observed.document.children[0], heading);
    assert.deepEqual(heading, nativeHeading);
    assert.deepEqual(
      snapshot(foreign),
      before,
      "foreign target/cache bytes must remain unchanged",
    );
    console.log(
      `Installed preparation ${index} verified: ${sha256(preparedWasm)}`,
    );
  }
  console.log(
    "Source preparation and installed-package provenance passed twice",
  );
  const failedTemporary = join(temporary, "failed producer temp");
  mkdirSync(failedTemporary);
  run(
    process.execPath,
    ["scripts/build-bindings.mjs"],
    older,
    {
      ...environment,
      RUSTC: join(temporary, "missing compiler"),
      TMPDIR: failedTemporary,
      TMP: failedTemporary,
      TEMP: failedTemporary,
    },
    1,
  );
  assert.deepEqual(
    readdirSync(failedTemporary).filter((name) =>
      name.startsWith("oq-bindings-"),
    ),
    [],
    "failed producer must reclaim its temporary build",
  );
  assert.deepEqual(
    snapshot(foreign),
    before,
    "failed producer must preserve the foreign cache too",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
