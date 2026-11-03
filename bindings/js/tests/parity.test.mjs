// The actual compiled WASM module and native CLI share real fixture files.
// No WASM exports, parser functions, processes, or filesystem calls are mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createOq } from "../dist/index.js";
const root = resolve(import.meta.dirname, "../../..");
const bytes = readFileSync(join(root, "bindings/js/dist/oq.wasm"));
const module = await WebAssembly.compile(bytes);
const cli = join(
  process.env.CARGO_TARGET_DIR || join(root, "target"),
  "debug",
  process.platform === "win32" ? "oq.exe" : "oq",
);
const fixture = (name) =>
  readFileSync(join(root, "tests/fixtures", name), "utf8");
const schema = fixture("shapes.schema.toml");
test("standard Org comma quoting and unescaped headings agree across native and WASM", async (t) => {
  const oq = await createOq(bytes);
  const temporary = mkdtempSync(join(tmpdir(), "oq-quoting-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "input.org");
  const quoted =
    "#+BEGIN_SRC org\r\n,* Literal 雪\r\n- [ ] example\r\n#+END_SRC\r\n* Real\r\n";
  for (const [source, titles] of [
    [quoted, ["Real"]],
    [quoted.replace(",* Literal", "* Literal"), ["Literal 雪", "Real"]],
  ]) {
    writeFileSync(path, source);
    const expression = "[.children[].title]";
    assert.deepEqual(oq.query(source, expression), [titles]);
    assert.deepEqual(native(["query", expression, path]), [titles]);
  }
});
function native(args) {
  const result = runCli(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").filter(Boolean).map(JSON.parse);
}
function runCli(args) {
  const result = spawnSync(cli, args, { encoding: "utf8" });
  const logs = join(root, ".result/logs");
  mkdirSync(logs, { recursive: true });
  const path = join(logs, `node-cli-${randomUUID()}.log`);
  writeFileSync(
    path,
    `argv: ${JSON.stringify([cli, ...args])}\nstatus: ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}\n${result.error ?? ""}`,
  );
  console.log(`subprocess log: ${path} (${statSync(path).size} bytes)`);
  if (result.error) throw result.error;
  return result;
}

test("WASM has no host imports and parses exactly the native JSON view", async () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const oq = await createOq(module);
  const source = fixture("rich.org");
  assert.deepEqual(
    oq.parse(source),
    native(["query", ".", join(root, "tests/fixtures/rich.org")])[0],
  );
  const expression =
    '.sections.Work.children[] | select(.properties.state == "active") | .title';
  assert.deepEqual(oq.query(source, expression), ["A1: Build"]);
  assert.deepEqual(
    oq.query(source, expression),
    native(["query", expression, join(root, "tests/fixtures/rich.org")]),
  );
});

test("WASM/native mode and exact diagnostics parity includes rejection twins", async (t) => {
  const oq = await createOq(bytes);
  const temporary = mkdtempSync(join(tmpdir(), "oq-parity-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const schemaPath = join(temporary, "schema.toml");
  const path = join(temporary, "input.org");
  writeFileSync(schemaPath, schema);
  for (const [name, mode] of [
    ["inline.org", "inline"],
    ["wiki.org", "wiki"],
    ["split.org", "split"],
    ["refinement.org", "refinement"],
  ]) {
    const source = fixture(name);
    writeFileSync(path, source);
    assert.deepEqual(oq.validate(source, schema), { mode, diagnostics: [] });
    assert.deepEqual(
      oq.validate(source, schema),
      native(["validate", "--schema", schemaPath, path])[0],
    );
  }
  const invalid =
    "#+TITLE: Wrong\n* Work\n** A1: First\n:PROPERTIES:\n:state: broken\n:END:\n";
  writeFileSync(path, invalid);
  const result = runCli(["validate", "--schema", schemaPath, path]);
  assert.equal(result.status, 1);
  assert.deepEqual(oq.validate(invalid, schema), JSON.parse(result.stdout));
  assert.deepEqual(oq.validate(invalid, schema).diagnostics, [
    {
      rule_id: "title.suffix",
      severity: "warning",
      line: 1,
      message: "Title should end with Roadmap",
    },
    {
      rule_id: "work.state",
      severity: "error",
      line: 5,
      message: "Invalid state for A1: First",
    },
  ]);
  const overlay = schema.replace(
    '"planned", "active", "done"',
    '"planned", "active", "done", "broken"',
  );
  const expectedOverlay = {
    mode: "inline",
    diagnostics: [
      {
        rule_id: "title.suffix",
        severity: "warning",
        line: 1,
        message: "Title should end with Roadmap",
      },
    ],
  };
  assert.deepEqual(oq.validate(invalid, overlay), expectedOverlay);
  writeFileSync(schemaPath, overlay);
  const overlayNative = runCli(["validate", "--schema", schemaPath, path]);
  assert.equal(overlayNative.status, 0);
  assert.equal(overlayNative.stderr, "");
  assert.deepEqual(JSON.parse(overlayNative.stdout), expectedOverlay);
});

test("journal corpus pins complete native/WASM reports and parsed source coordinates", async (t) => {
  const oq = await createOq(module);
  const cases = JSON.parse(fixture("journal-cases.json"));
  assert.equal(cases.length, 6);
  const temporary = mkdtempSync(join(tmpdir(), "oq-journal-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "entry.org"),
    schemaPath = join(temporary, "schema.toml");
  const journal = fixture("journal.schema.toml");
  writeFileSync(schemaPath, journal);
  for (const item of cases) {
    writeFileSync(path, item.source);
    const parsed = oq.parse(item.source);
    assert.equal(parsed.children.length, 1);
    const node = parsed.children[0];
    assert.deepEqual(
      {
        line: node.line,
        properties: node.properties,
        property_lines: node.property_lines,
        property_order: node.property_order,
        nonempty_content: node.content.filter((line) => line.text.trim()),
      },
      item.parsed,
      item.name,
    );
    const nativeNode = native(["query", ".children[0]", path])[0];
    assert.deepEqual(
      {
        line: nativeNode.line,
        properties: nativeNode.properties,
        property_lines: nativeNode.property_lines,
        property_order: nativeNode.property_order,
        nonempty_content: nativeNode.content.filter((line) => line.text.trim()),
      },
      item.parsed,
      item.name,
    );
    assert.deepEqual(oq.validate(item.source, journal), item.report, item.name);
    const result = runCli(["validate", "--schema", schemaPath, path]);
    assert.equal(result.status, item.status, item.name);
    assert.equal(result.stderr, "", item.name);
    assert.equal(result.stdout.trim().split("\n").length, 1, item.name);
    assert.deepEqual(JSON.parse(result.stdout), item.report, item.name);
  }
});

test("WASM lossless edits preserve Unicode, CRLF, and untouched bytes", async (t) => {
  const oq = await createOq(module);
  const temporary = mkdtempSync(join(tmpdir(), "oq-edits-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "input.org");
  const source =
    "* Café\r\n:PROPERTIES:\r\n:state: old\r\n:END:\r\nBody 雪.\r\n";
  const expression = '.sections["Café"].properties.state = "新"';
  writeFileSync(path, source);
  const expected = source.replace(":state: old", ":state: 新");
  assert.equal(oq.set(source, expression), expected);
  const result = runCli(["set", expression, path]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.throws(() => oq.set(source, ".children = []"), /unsupported edit/);
  assert.throws(() => oq.set(source, ".children[0].line = 0"), /read-only/);
  assert.throws(
    () =>
      oq.set(
        source,
        '.sections["Café"].properties.state="X" | .children[0].properties.state="Y"',
      ),
    /conflicting/,
  );
});

test("repeated wrapper failures clean up allocations and preserve later calls", async () => {
  const oq = await createOq(bytes);
  const source = fixture("rich.org");
  for (let i = 0; i < 200; i++) {
    assert.throws(() => oq.query(source, ".["), /invalid expression/);
    assert.throws(() => oq.query(source, "halt"), /halt\(0\).*not permitted/);
    assert.throws(() => oq.validate(source, "version=99"), /invalid schema/);
    assert.deepEqual(oq.query(source, ".title"), ["Unicode café Roadmap"]);
  }
});

test("raw ABI owns independent response buffers, handles bad UTF-8, and releases memory", async () => {
  const instance = await WebAssembly.instantiate(module, {});
  const e = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function request(bytes) {
    const input = e.oq_alloc(bytes.length) >>> 0;
    let output, length;
    try {
      new Uint8Array(e.memory.buffer, input, bytes.length).set(bytes);
      const packed = e.oq_execute(input, bytes.length);
      output = Number(packed >> 32n) >>> 0;
      length = Number(packed & 0xffffffffn) >>> 0;
      return JSON.parse(
        decoder.decode(new Uint8Array(e.memory.buffer, output, length)),
      );
    } finally {
      if (output !== undefined) e.oq_free(output, length);
      e.oq_free(input, bytes.length);
    }
  }
  function retain(bytes) {
    const input = e.oq_alloc(bytes.length) >>> 0;
    try {
      new Uint8Array(e.memory.buffer, input, bytes.length).set(bytes);
      const packed = e.oq_execute(input, bytes.length);
      return {
        input,
        inputLength: bytes.length,
        output: Number(packed >> 32n) >>> 0,
        length: Number(packed & 0xffffffffn) >>> 0,
      };
    } catch (error) {
      e.oq_free(input, bytes.length);
      throw error;
    }
  }
  const responseBytes = (r) =>
    new Uint8Array(e.memory.buffer, r.output, r.length);
  const release = (r) => {
    e.oq_free(r.output, r.length);
    e.oq_free(r.input, r.inputLength);
  };
  const queryBytes = (title) =>
    encoder.encode(
      JSON.stringify({
        op: "query",
        source: `* ${title}\n`,
        expression: ".children[0].title",
      }),
    );
  let first, second;
  try {
    first = retain(queryBytes("First 雪"));
    const original = responseBytes(first).slice();
    second = retain(queryBytes("Second café"));
    assert.ok(
      first.output + first.length <= second.output ||
        second.output + second.length <= first.output,
      "simultaneously owned response ranges must not overlap",
    );
    assert.deepEqual(JSON.parse(decoder.decode(responseBytes(first))), {
      ok: ["First 雪"],
    });
    assert.deepEqual(JSON.parse(decoder.decode(responseBytes(second))), {
      ok: ["Second café"],
    });
    assert.deepEqual(
      responseBytes(first),
      original,
      "second execution must not overwrite the first result",
    );
    release(second);
    second = undefined;
    assert.deepEqual(
      responseBytes(first),
      original,
      "freeing the second result must retain the first allocation",
    );
    assert.deepEqual(JSON.parse(decoder.decode(responseBytes(first))), {
      ok: ["First 雪"],
    });
  } finally {
    if (second) release(second);
    if (first) release(first);
  }
  assert.ok(request(new Uint8Array([0xff])).error);
  assert.ok(request(new Uint8Array()).error);
  const input = encoder.encode(
    JSON.stringify({
      op: "query",
      source: "* 雪\n",
      expression: ".children[0].title",
    }),
  );
  for (let i = 0; i < 30; i++) assert.deepEqual(request(input), { ok: ["雪"] });
  const warmed = e.memory.buffer.byteLength;
  for (let i = 0; i < 400; i++)
    assert.deepEqual(request(input), { ok: ["雪"] });
  assert.equal(
    e.memory.buffer.byteLength,
    warmed,
    "released buffers should be reused, not grow memory per call",
  );
  const errors = [new Uint8Array([0xff]), encoder.encode('{"op":"unknown"}')];
  function rejectAll() {
    for (const bytes of errors) {
      const response = request(bytes);
      assert.equal(typeof response.error, "string");
      assert.ok(response.error.length > 0);
    }
  }
  for (let i = 0; i < 30; i++) rejectAll();
  const errorWarmed = e.memory.buffer.byteLength;
  for (let i = 0; i < 400; i++) rejectAll();
  assert.equal(
    e.memory.buffer.byteLength,
    errorWarmed,
    "repeated malformed UTF-8/JSON error response allocations must be freed and reused",
  );
});
