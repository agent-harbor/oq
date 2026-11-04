/**
 * Real npm Git/Yarn 4.13 source-archive integration tests. No package manager,
 * compiler, engine, filesystem, or WASM implementation is mocked. A reserved
 * HTTPS fixture URL is mapped to an owned local Git repository by invocation-
 * scoped Git insteadOf configuration. This transparent transport mapping lets
 * both real managers clone and pin actual Git commits without network hosting,
 * credentials, global Git configuration, or a fake Git executable.
 *
 * An actual native transparent rustc wrapper records compilation working
 * directories to prove checkout bootstrap never builds Rust and dependency
 * postinstall does. It forwards any inherited outer/workspace wrappers. Cold
 * package/global/target caches and two valid compiler configurations must retain
 * identical immutable source archives/locks while producing different, correct
 * installed WASM. Default CI uses release opt-level 0/1 on the pinned compiler
 * to keep repeated real builds affordable. The bindings/prebuilt/parity gates
 * exercise normal releases; explicit toolchain acceptance keeps opt-level 3.
 * --toolchains <bin-a> <bin-b> runs the same assertions on explicitly supplied
 * real environments. Nothing is skipped when a second toolchain is absent.
 *
 * Additional real boundaries cover warm-WASM exclusion, LF checkout controls,
 * literal exports/declarations/raw CRLF/Unicode/edit expectations, enabled-script
 * rebuilds, surviving WASM, malformed layouts, compiler/source failure cleanup,
 * and unchanged foreign artifacts. Frozen historical packaging is restored only
 * in a counterfactual Git fixture: successful preparation must fail specifically
 * Yarn YN0018 under changed compiler inputs, never a compilation failure.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  commonFiles,
  packageLayout,
  rustDirectory,
  rustInputs,
  sourceFiles,
  sourceScripts,
  stagePrebuilt,
} from "./package-layout.mjs";

const root = process.cwd();
const yarn = resolve("node_modules/@yarnpkg/cli-dist/bin/yarn.js");
assert.ok(existsSync(yarn), "install the locked public Yarn test dependency");
const toolchainOption = process.argv.indexOf("--toolchains");
assert.ok(
  process.argv.length === 2 || toolchainOption === 2,
  "usage: test-source-packages.mjs [--toolchains <bin-a> <bin-b>]",
);
const bins =
  toolchainOption < 0 ? null : process.argv.slice(toolchainOption + 1);
if (bins)
  assert.equal(
    bins.length,
    2,
    "--toolchains requires two actual compiler bin directories",
  );
if (bins)
  for (const directory of bins)
    for (const compiler of ["cargo", "rustc"])
      assert.ok(
        existsSync(
          join(
            directory,
            `${compiler}${process.platform === "win32" ? ".exe" : ""}`,
          ),
        ),
        `explicit toolchain must supply ${compiler}`,
      );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
mkdirSync(".result/logs", { recursive: true });
const temporary = mkdtempSync(resolve(".result/source packages "));
const sourceText =
  "* =Title= 雪\r\nBody /text/.\r\n- [x] Read [[file:guide.org]]\r\n| | alpha || gamma |   | omega |\r\n";
const fixtureUrl = "https://source-package-fixture.invalid/engine.git";

function run(
  command,
  args,
  cwd = root,
  env = process.env,
  expected = 0,
  errorPattern,
) {
  const windowsNpm = process.platform === "win32" && command === "npm";
  const result = spawnSync(
    windowsNpm ? process.execPath : command,
    windowsNpm
      ? [
          join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
          ...args,
        ]
      : args,
    { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const receipt = { command, args, cwd, status: result.status };
  const log = resolve(
    ".result/logs",
    `source-package-subprocess-${randomUUID()}.log`,
  );
  writeFileSync(
    log,
    `${JSON.stringify(receipt)}\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.stack ?? ""}`,
  );
  console.log(
    `${JSON.stringify(receipt)} (${log}, ${statSync(log).size} bytes)`,
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expected,
    `${command}: unexpected exit; see ${log}`,
  );
  if (errorPattern)
    assert.match(`${result.stdout}${result.stderr}`, errorPattern);
  return result.stdout;
}

function tree(dir, prefix = "") {
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name),
        name = prefix + entry.name;
      return entry.isDirectory()
        ? Object.entries(tree(path, `${name}/`))
        : [[name, hash(readFileSync(path))]];
    }),
  );
}

function repository(name, historical = false) {
  const dir = join(temporary, name);
  mkdirSync(dir);
  for (const path of [
    "package.json",
    "package-lock.json",
    "oq-checkout.json",
    ".gitignore",
    ".gitattributes",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "crates",
    "bindings/js/src",
    "bindings/js/tsconfig.json",
    "scripts",
    "README.md",
    "LICENSE",
    "docs/contract.md",
    "tests/fixtures",
  ])
    cpSync(path, join(dir, path), { recursive: true });
  if (historical) {
    for (const [file, expected] of [
      [
        "package.json",
        "f758f688bd00b0c1ef74be4a7648c14fad0b3b433a8bdaea4f206b221887003b",
      ],
      [
        "package-lock.json",
        "b159c9dbebc100c4d6b287521434ab9ef211be914a1a4ac70d96085ffee15d6a",
      ],
      [
        "build-bindings.mjs",
        "070d134e36bba5b45050b3c704a9a7fef91cd5de0d4b666cd19169d672cbeaf4",
      ],
    ]) {
      const bytes = readFileSync(
        join(root, "tests/fixtures/archive-provenance-before", file),
      );
      assert.equal(
        hash(bytes),
        expected,
        `historical packaging fixture changed: ${file}`,
      );
      writeFileSync(
        join(
          dir,
          file === "build-bindings.mjs" ? "scripts/build-bindings.mjs" : file,
        ),
        bytes,
      );
    }
  }
  run("git", ["init", "--initial-branch=main"], dir);
  run("git", ["add", "."], dir);
  run(
    "git",
    [
      "-c",
      "user.name=Package tests",
      "-c",
      "user.email=packages@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "test: immutable source package fixture",
      "-m",
      "Exercise real Git package preparation and installation.",
    ],
    dir,
  );
  const commit = run("git", ["rev-parse", "HEAD"], dir).trim();
  return { dir, commit, dependency: `git+${fixtureUrl}#${commit}` };
}

const wrapperSource = join(temporary, "compiler recorder.rs");
const wrapper = join(
  temporary,
  `compiler recorder${process.platform === "win32" ? ".exe" : ""}`,
);
writeFileSync(
  wrapperSource,
  `use std::{env,fs::OpenOptions,io::Write,process::{Command,exit}};
fn main(){let args:Vec<_>=env::args_os().skip(1).collect();let cwd=env::current_dir().unwrap();
let name=args.windows(2).find(|a|a[0]=="--crate-name").and_then(|a|a[1].to_str()).unwrap_or("probe");
let query=args.iter().any(|a|a.to_str().is_some_and(|s|s=="-"||s=="-vV"||s=="-V"||s=="--version"||s.starts_with("--print")));
let input=args.iter().find_map(|a|a.to_str().filter(|s|!s.starts_with('-')&&s.ends_with(".rs"))).unwrap_or("");
let manifest=env::var("CARGO_MANIFEST_DIR").unwrap_or_default();let mut bootstrap=false;
let host=env::var_os("OQ_PACKAGE_HOST_CHECKOUT").map(std::path::PathBuf::from);
for parent in cwd.ancestors(){if host.as_deref()==Some(parent){break;}if parent.join("package.json").is_file(){bootstrap=parent.join("oq-checkout.json").is_file();break;}}
if let Some(path)=env::var_os("OQ_PACKAGE_COMPILER_LOG"){let tab=char::from(9);let record=format!("{name}{tab}{}{tab}{manifest}{tab}{bootstrap}{tab}{query}{tab}{input}{tab}{:?}{}",cwd.display(),args,char::from(10));
let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();let file=std::path::PathBuf::from(path).join(format!("{}-{stamp}.log",std::process::id()));
OpenOptions::new().create_new(true).write(true).open(file).unwrap().write_all(record.as_bytes()).unwrap();}
let mut command=if let Some(inner)=env::var_os("OQ_INNER_RUSTC_WRAPPER"){let mut c=Command::new(inner);c.args(&args);c}else{let mut c=Command::new(&args[0]);c.args(&args[1..]);c};
exit(command.status().expect("real compiler execution").code().unwrap_or(1));}
`,
);

function environment(label, repo, index) {
  const dir = join(temporary, label);
  mkdirSync(dir);
  const tmp = join(dir, "tmp"),
    foreign = join(dir, "foreign target");
  mkdirSync(tmp);
  mkdirSync(join(foreign, "wasm32-unknown-unknown/release"), {
    recursive: true,
  });
  writeFileSync(
    join(foreign, "caller-owned.txt"),
    "preserve this foreign cache\n",
  );
  copyFileSync(
    "bindings/js/dist/oq.wasm",
    join(foreign, "wasm32-unknown-unknown/release/oq_wasm.wasm"),
  );
  const compilerLog = resolve(
    ".result/logs",
    `source-package-compiler-${label.replaceAll(" ", "-")}-${randomUUID()}`,
  );
  mkdirSync(compilerLog);
  console.log(JSON.stringify({ phase: label, compilerEvidence: compilerLog }));
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo.dir).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: fixtureUrl,
    GIT_CONFIG_KEY_1: "core.autocrlf",
    GIT_CONFIG_VALUE_1: index ? "true" : "false",
    npm_config_cache: join(dir, "npm cache"),
    npm_config_update_notifier: "false",
    YARN_CACHE_FOLDER: join(dir, "yarn cache"),
    YARN_GLOBAL_FOLDER: join(dir, "yarn global"),
    YARN_ENABLE_GLOBAL_CACHE: "false",
    YARN_CHECKSUM_BEHAVIOR: "throw",
    YARN_ENABLE_SCRIPTS: "true",
    CARGO_TARGET_DIR: foreign,
    CARGO_BUILD_BUILD_DIR: join(foreign, "build"),
    CARGO_PROFILE_RELEASE_OPT_LEVEL: bins ? "3" : index ? "1" : "0",
    RUSTC_WRAPPER: wrapper,
    OQ_PACKAGE_COMPILER_LOG: compilerLog,
    OQ_PACKAGE_HOST_CHECKOUT: realpathSync(root),
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
  };
  if (process.env.RUSTC_WRAPPER)
    env.OQ_INNER_RUSTC_WRAPPER = process.env.RUSTC_WRAPPER;
  if (bins) {
    env.PATH =
      bins[index] +
      (process.platform === "win32" ? ";" : ":") +
      process.env.PATH;
    env.RUSTC = join(
      bins[index],
      `rustc${process.platform === "win32" ? ".exe" : ""}`,
    );
    env.RUSTDOC = join(
      bins[index],
      `rustdoc${process.platform === "win32" ? ".exe" : ""}`,
    );
  }
  return { dir, tmp, foreign, before: tree(foreign), compilerLog, env };
}

function cleanProducer(state) {
  compilerRecords(state.compilerLog);
  assert.deepEqual(
    tree(state.foreign),
    state.before,
    "foreign artifacts and cache bytes must survive",
  );
  assert.deepEqual(
    readdirSync(state.tmp).filter((name) => name.startsWith("oq-bindings-")),
    [],
    "owned compiler output must be reclaimed",
  );
}

function compilerRecords(directory) {
  return readdirSync(directory)
    .sort()
    .map((name) => {
      assert.ok(
        name.endsWith(".log"),
        "each compiler evidence file must be a log",
      );
      const text = readFileSync(join(directory, name), "utf8");
      const lines = text.split("\n");
      assert.equal(
        lines.length,
        2,
        "each compiler invocation must retain exactly one complete record",
      );
      assert.equal(lines[1], "", "compiler records must end with LF");
      const fields = lines[0].split("\t");
      assert.equal(
        fields.length,
        7,
        `malformed compiler evidence: ${join(directory, name)}`,
      );
      assert.ok(["true", "false"].includes(fields[3]));
      assert.ok(["true", "false"].includes(fields[4]));
      return lines[0];
    });
}

function runtimeProbe(consumer) {
  const script = join(consumer, "probe.mjs");
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createOq}from'@agent-harbor/oq';
const source=${JSON.stringify(sourceText)};const bytes=readFileSync(new URL(import.meta.resolve('@agent-harbor/oq/oq.wasm')));const oq=await createOq(bytes);const h=oq.parse(source).children[0];
assert.equal(h.title,'=Title= 雪');assert.equal(h.title_plain,'Title 雪');assert.equal(h.items[0].checkbox,'X');assert.equal(h.items[0].text,'Read [[file:guide.org]]');assert.equal(h.items[0].text_plain,'Read file:guide.org');
assert.deepEqual(h.tables[0][0].cells,['','alpha','','gamma','','omega']);assert.deepEqual(h.paragraphs,[{text:'Body /text/.\\r\\n',plain:'Body text.\\r\\n',line:2,start:15,end:29}]);
assert.equal(oq.set(source,'.'),source);assert.equal(oq.set(source,'.children[0].tables[0][0].cells[2]="filled"'),source.replace('alpha ||','alpha |filled|'));assert.equal(oq.set(source,'.children[0].title="Changed"'),source.replace('=Title= 雪','Changed'));assert.throws(()=>oq.set(source,'.children[0].title_plain="bad"'));
console.log('installed public exports and literal engine assertions passed');`,
  );
  run(process.execPath, [script], consumer);
}

function probe(consumer) {
  runtimeProbe(consumer);
  const installed = join(consumer, "node_modules/@agent-harbor/oq");
  assert.equal(packageLayout(installed), "source");
  assert.equal(existsSync(join(installed, "oq-checkout.json")), false);
  assert.equal(existsSync(join(installed, "Cargo.toml")), false);
  assert.equal(existsSync(join(installed, "crates")), false);
  for (const file of commonFiles.slice(0, 2))
    assert.equal(
      readFileSync(join(installed, file)).includes(13),
      false,
      `LF output: ${file}`,
    );
  for (const file of rustInputs)
    assert.equal(
      readFileSync(join(installed, rustDirectory, file)).includes(13),
      false,
      `LF staged input: ${file}`,
    );
  writeFileSync(
    join(consumer, "consumer.ts"),
    `import{createOq}from'@agent-harbor/oq';
const oq=await createOq(new Uint8Array());const h=oq.parse('* Example\\n').children[0];h.title_plain satisfies string;h.items[0].text_plain satisfies string;h.paragraphs[0].plain satisfies string;
// @ts-expect-error read-only projection
h.title_plain='bad';
// @ts-expect-error read-only projection
h.items[0].text_plain='bad';
// @ts-expect-error read-only paragraphs
h.paragraphs.push(h.paragraphs[0]);
`,
  );
  run(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
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
  return {
    installed,
    wasm: hash(readFileSync(join(installed, "bindings/js/dist/oq.wasm"))),
  };
}

function assertInstalledCompilation(state, installed) {
  const expected = realpathSync(join(installed, rustDirectory));
  const registry = join(
    state.env.CARGO_HOME
      ? resolve(expected, state.env.CARGO_HOME)
      : join(homedir(), ".cargo"),
    "registry",
    "src",
  );
  const entries = compilerRecords(state.compilerLog);
  assert.ok(
    entries.length > 0,
    "real compiler must execute at dependency installation",
  );
  const within = (parent, path) => {
    const part = relative(parent, path);
    return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
  };
  const required = new Set(["oq_core", "oq_wasm"]);
  for (const entry of entries) {
    const [crate, cwd, manifest, bootstrap, query, input] = entry.split("\t");
    assert.equal(
      bootstrap,
      "false",
      "Git checkout bootstrap must never invoke Rust",
    );
    if (crate === "oq_core" || crate === "oq_wasm") {
      assert.equal(
        query,
        "false",
        "workspace compilation must be real source compilation, not target discovery",
      );
      assert.equal(
        realpathSync(manifest),
        realpathSync(join(expected, "crates", crate.replaceAll("_", "-"))),
        "workspace compilation must select the installed staged crate",
      );
      assert.ok(
        within(expected, cwd),
        "workspace compiler cwd must be inside installed staged sources",
      );
      assert.equal(
        realpathSync(resolve(cwd, input)),
        realpathSync(
          join(expected, "crates", crate.replaceAll("_", "-"), "src/lib.rs"),
        ),
        "real workspace input must be the installed staged source file",
      );
      required.delete(crate);
    } else if (within(expected, cwd)) {
      assert.ok(
        query === "true" || (manifest && within(registry, manifest)),
        "only Cargo probes or registry dependencies compile from the installed workspace",
      );
    } else {
      // Dependency build scripts such as autocfg legitimately run their rustc
      // probes from registry sources or this invocation's temporary build tree.
      assert.ok(
        within(registry, cwd) ||
          (within(state.tmp, cwd) &&
            relative(state.tmp, cwd).split(sep)[0].startsWith("oq-bindings-")),
        "dependency probes must stay in registry or owned build directories",
      );
      assert.ok(
        (manifest && within(registry, manifest)) ||
          (query === "true" && within(registry, cwd)),
        "dependency probes must identify actual registry inputs",
      );
    }
  }
  assert.equal(
    required.size,
    0,
    "both oq-core and oq-wasm must really compile from installed sources",
  );
  cleanProducer(state);
}

try {
  run("rustc", [
    "--crate-name",
    "compiler_recorder",
    wrapperSource,
    "-o",
    wrapper,
  ]);
  const recorderLog = resolve(
    ".result/logs",
    `source-package-recorder-self-test-${randomUUID()}`,
  );
  mkdirSync(recorderLog);
  run(
    wrapper,
    [
      process.env.RUSTC ?? "rustc",
      "-",
      "--crate-name",
      "___",
      "--print=file-names",
      "--target",
      "wasm32-unknown-unknown",
      "--crate-type",
      "rlib",
    ],
    root,
    {
      ...process.env,
      OQ_PACKAGE_COMPILER_LOG: recorderLog,
      OQ_PACKAGE_HOST_CHECKOUT: realpathSync(root),
    },
  );
  const selfRecords = compilerRecords(recorderLog);
  assert.equal(selfRecords.length, 1);
  const recorderFields = selfRecords[0].split("\t");
  assert.equal(
    recorderFields.length,
    7,
    "compiler evidence must preserve its exact field protocol",
  );
  assert.equal(recorderFields[0], "___");
  assert.equal(
    recorderFields[3],
    "false",
    "outer test checkout is not a bootstrap clone",
  );
  assert.equal(
    recorderFields[4],
    "true",
    "named --print/stdin target discovery is a query",
  );
  assert.equal(recorderFields[5], "");
  assert.match(recorderFields[6], /--print=file-names/);
  run(process.execPath, [yarn, "--version"]);
  const repo = repository("source Git fixture");
  const warm = environment("warm checkout", repo, 0);
  run(
    "npm",
    ["ci", "--foreground-scripts", "--no-audit", "--no-fund"],
    repo.dir,
    { ...warm.env, RUSTC: join(temporary, "missing bootstrap compiler") },
  );
  assert.deepEqual(
    compilerRecords(warm.compilerLog),
    [],
    "root install/prepare must not invoke Rust",
  );
  copyFileSync(
    "bindings/js/dist/oq.wasm",
    join(repo.dir, "bindings/js/dist/oq.wasm"),
  );
  assert.equal(
    packageLayout(repo.dir),
    "checkout",
    "generated staging and WASM remain a valid checkout",
  );
  const packed = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", warm.dir],
      repo.dir,
      warm.env,
    ),
  );
  assert.deepEqual(
    packed[0].files.map((entry) => entry.path).sort(),
    [...sourceFiles, "package.json"].sort(),
    "archive must match the exact source allowlist",
  );
  assert.ok(packed[0].files.every((entry) => !entry.path.endsWith(".wasm")));
  assert.ok(
    !packed[0].files.some((entry) => entry.path === "oq-checkout.json"),
  );
  cleanProducer(warm);
  const releaseLayout = join(temporary, "prebuilt layout");
  stagePrebuilt(root, releaseLayout);
  assert.equal(packageLayout(releaseLayout), "prebuilt");
  const releaseManifest = JSON.parse(
    readFileSync(join(releaseLayout, "package.json"), "utf8"),
  );
  assert.equal(releaseManifest.scripts, undefined);
  assert.equal(releaseManifest.devDependencies, undefined);
  mkdirSync(join(releaseLayout, "scripts"));
  copyFileSync(
    "scripts/build-wasm.mjs",
    join(releaseLayout, "scripts/build-wasm.mjs"),
  );
  assert.throws(
    () => packageLayout(releaseLayout),
    /must not contain source inputs or lifecycle hooks/,
  );
  rmSync(join(releaseLayout, "scripts"), { recursive: true });
  mkdirSync(join(releaseLayout, rustDirectory), { recursive: true });
  assert.throws(
    () => packageLayout(releaseLayout),
    /must not contain source inputs or lifecycle hooks/,
  );
  run(
    "npm",
    ["run", "prepublishOnly"],
    repo.dir,
    warm.env,
    1,
    /use just release-package/,
  );

  const lfClone = join(temporary, "autocrlf checkout");
  run("git", [
    "-c",
    "core.autocrlf=true",
    "clone",
    "--no-hardlinks",
    repo.dir,
    lfClone,
  ]);
  for (const file of [
    ...rustInputs,
    ...sourceScripts,
    "package.json",
    "package-lock.json",
    "oq-checkout.json",
    "bindings/js/src/index.ts",
    "bindings/js/tsconfig.json",
    "README.md",
    "LICENSE",
    "docs/contract.md",
  ])
    assert.equal(
      readFileSync(join(lfClone, file)).includes(13),
      false,
      `Git must retain LF: ${file}`,
    );
  assert.deepEqual(
    tree(join(lfClone, "tests/fixtures")),
    tree(join(repo.dir, "tests/fixtures")),
    "byte-sensitive fixtures must remain exact",
  );

  const outcomes = {};
  for (const manager of ["npm", "yarn"]) {
    let firstLock;
    let archiveIdentity;
    const phases = [];
    for (const index of [0, 1]) {
      const state = environment(`${manager} source ${index}`, repo, index);
      const consumer = join(state.dir, "consumer");
      mkdirSync(consumer);
      writeFileSync(
        join(consumer, "package.json"),
        `${JSON.stringify({ name: "source-consumer", private: true, type: "module", packageManager: "yarn@4.13.0", dependencies: { "@agent-harbor/oq": repo.dependency } }, null, 2)}\n`,
      );
      if (manager === "yarn") {
        writeFileSync(
          join(consumer, ".yarnrc.yml"),
          "checksumBehavior: throw\nenableGlobalCache: false\nenableScripts: true\nnodeLinker: node-modules\n",
        );
        writeFileSync(join(consumer, "yarn.lock"), firstLock ?? "");
      } else if (firstLock)
        writeFileSync(join(consumer, "package-lock.json"), firstLock);
      run("cargo", ["--version"], consumer, state.env);
      run("rustc", ["--version"], consumer, state.env);
      if (manager === "npm")
        run(
          "npm",
          [
            index ? "ci" : "install",
            "--foreground-scripts",
            "--no-audit",
            "--no-fund",
          ],
          consumer,
          state.env,
        );
      else
        run(
          process.execPath,
          [yarn, "install", ...(index ? ["--immutable"] : [])],
          consumer,
          state.env,
        );
      const lock = readFileSync(
        join(consumer, manager === "yarn" ? "yarn.lock" : "package-lock.json"),
      );
      if (firstLock)
        assert.deepEqual(
          lock,
          firstLock,
          "immutable source lock bytes must be identical across compiler inputs",
        );
      else firstLock = lock;
      const result = probe(consumer);
      assertInstalledCompilation(state, result.installed);
      phases.push({ state, consumer, ...result, lock: hash(lock) });
    }
    assert.notEqual(
      phases[0].wasm,
      phases[1].wasm,
      "real compiler inputs must change installed WASM bytes",
    );
    if (manager === "yarn") {
      const checksums = phases.map((phase) =>
        [
          ...readFileSync(join(phase.consumer, "yarn.lock"), "utf8").matchAll(
            /^\s+checksum: (.+)$/gm,
          ),
        ].map((match) => match[1]),
      );
      assert.equal(
        checksums[0].length,
        1,
        "Git archive must have a recorded strict checksum",
      );
      assert.deepEqual(
        checksums[0],
        checksums[1],
        "fetched source archive checksum must ignore compiler inputs",
      );
      const archives = phases.map((phase) =>
        readdirSync(phase.state.env.YARN_CACHE_FOLDER)
          .filter((name) => name.endsWith(".zip"))
          .map((name) =>
            hash(readFileSync(join(phase.state.env.YARN_CACHE_FOLDER, name))),
          ),
      );
      assert.equal(archives[0].length, 1);
      assert.deepEqual(
        archives[0],
        archives[1],
        "cold fetched archive bytes must be identical",
      );
      archiveIdentity = { checksum: checksums[0][0], sha256: archives[0][0] };
    }
    const first = phases[0];
    const existing = first.wasm;
    const rebuildState = environment(`${manager} rebuild`, repo, 1);
    if (manager === "npm")
      run(
        "npm",
        ["rebuild", "@agent-harbor/oq", "--foreground-scripts"],
        first.consumer,
        rebuildState.env,
      );
    else
      run(
        process.execPath,
        [yarn, "rebuild", "@agent-harbor/oq"],
        first.consumer,
        rebuildState.env,
      );
    const rebuilt = probe(first.consumer);
    assert.notEqual(
      rebuilt.wasm,
      existing,
      "standard rebuild must compile despite surviving WASM",
    );
    assertInstalledCompilation(rebuildState, rebuilt.installed);
    outcomes[manager] = {
      phases: phases.map(({ wasm, lock }) => ({ wasm, lock })),
      installed: rebuilt.installed,
      archive: archiveIdentity,
    };
  }

  const installed = outcomes.npm.installed;
  const malformed = join(temporary, "malformed source");
  cpSync(installed, malformed, { recursive: true });
  for (const path of rustInputs) {
    mkdirSync(dirname(join(malformed, path)), { recursive: true });
    copyFileSync(join(malformed, rustDirectory, path), join(malformed, path));
  }
  assert.throws(
    () => packageLayout(malformed),
    /must not contain a root Cargo workspace/,
    "complete root workspace without owner marker must be rejected",
  );
  rmSync(malformed, { recursive: true });
  cpSync(installed, malformed, { recursive: true });
  rmSync(join(malformed, rustDirectory, "crates/oq-core/src/document.rs"));
  assert.throws(() => packageLayout(malformed), /expected regular file/);
  rmSync(malformed, { recursive: true });
  cpSync(installed, malformed, { recursive: true });
  const manifestPath = join(malformed, "package.json");
  const invalid = JSON.parse(readFileSync(manifestPath, "utf8"));
  invalid.oqPackage.format = 2;
  writeFileSync(manifestPath, JSON.stringify(invalid));
  assert.throws(() => packageLayout(malformed), /Unknown or missing/);
  const marker = join(repo.dir, "oq-checkout.json");
  const markerBytes = readFileSync(marker);
  for (const declaration of [{ format: 2 }, { format: 1, extra: true }, null]) {
    writeFileSync(marker, JSON.stringify(declaration));
    assert.throws(() => packageLayout(repo.dir), /owner marker/);
  }
  writeFileSync(marker, markerBytes);

  const missing = environment("missing compiler", repo, 0);
  run(
    process.execPath,
    [join(installed, "scripts/install-bindings.mjs")],
    root,
    { ...missing.env, RUSTC: join(temporary, "missing compiler") },
    1,
    /missing compiler/,
  );
  cleanProducer(missing);
  const broken = join(temporary, "broken Rust source");
  cpSync(installed, broken, { recursive: true });
  const rust = join(broken, rustDirectory, "crates/oq-core/src/lib.rs");
  writeFileSync(
    rust,
    `${readFileSync(rust, "utf8")}\ncompile_error!("intentional source failure");\n`,
  );
  const failure = environment("source compiler failure", repo, 0);
  run(
    process.execPath,
    [join(broken, "scripts/install-bindings.mjs")],
    root,
    failure.env,
    1,
    /intentional source failure/,
  );
  assert.ok(
    compilerRecords(failure.compilerLog).length > 0,
    "source rejection must reach the real compiler",
  );
  cleanProducer(failure);

  const legacy = repository("compiled archive counterfactual", true);
  let legacyLock;
  for (const index of [0, 1]) {
    const state = environment(`compiled archive ${index}`, legacy, index);
    const consumer = join(state.dir, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "archive-counterfactual", private: true, dependencies: { "@agent-harbor/oq": legacy.dependency } })}\n`,
    );
    writeFileSync(
      join(consumer, ".yarnrc.yml"),
      "checksumBehavior: throw\nenableGlobalCache: false\nenableScripts: true\nnodeLinker: node-modules\n",
    );
    writeFileSync(join(consumer, "yarn.lock"), legacyLock ?? "");
    run(
      process.execPath,
      [yarn, "install", ...(index ? ["--immutable"] : [])],
      consumer,
      state.env,
      index ? 1 : 0,
      index
        ? /YN0018:.*remote archive doesn't match the expected checksum/
        : undefined,
    );
    if (!index) runtimeProbe(consumer);
    const lock = readFileSync(join(consumer, "yarn.lock"));
    if (legacyLock)
      assert.deepEqual(
        lock,
        legacyLock,
        "falsification must not rewrite the lock",
      );
    else legacyLock = lock;
    assert.ok(
      compilerRecords(state.compilerLog).length > 0,
      "counterfactual must really compile before checksum verification",
    );
    assert.ok(
      compilerRecords(state.compilerLog).some(
        (entry) => entry.split("\t")[3] === "true",
      ),
      "counterfactual must compile in its actual Git bootstrap checkout",
    );
    const built = readFileSync(
      join(state.foreign, "wasm32-unknown-unknown/release/oq_wasm.wasm"),
    );
    // The historical producer owns a separate target too; foreign bytes must
    // remain intact even while its compiled archive breaks the checksum boundary.
    assert.equal(
      hash(built),
      state.before["wasm32-unknown-unknown/release/oq_wasm.wasm"],
    );
    cleanProducer(state);
  }
  console.log(
    JSON.stringify(
      {
        sourceArchiveRegressions: "passed",
        compilerConfigurations: bins ?? [
          "release opt-level 0",
          "release opt-level 1",
        ],
        npm: outcomes.npm.phases,
        yarn: outcomes.yarn.phases,
        yarnSourceArchive: outcomes.yarn.archive,
        counterfactual: "YN0018 after real compilation",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
