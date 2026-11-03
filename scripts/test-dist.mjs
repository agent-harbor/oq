// The packaged native executable is unpacked and run, not just checked for existence.
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const stem = `oq-v${version}-${process.platform}-${process.arch}`;
const archive = resolve(".result/dist", `${stem}.tar.gz`);
const temporary = mkdtempSync(resolve(".result/native-consumer-"));
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  console.log(
    JSON.stringify({
      command,
      args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
try {
  assert.equal(
    readFileSync(`${archive}.sha256`, "utf8"),
    `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${stem}.tar.gz\n`,
  );
  run("tar", ["-xzf", archive, "-C", temporary]);
  const directory = join(temporary, stem);
  const executable = join(
    directory,
    process.platform === "win32" ? "oq.exe" : "oq",
  );
  const image = readFileSync(executable);
  if (process.platform === "linux") {
    assert.equal(image.subarray(0, 4).toString("hex"), "7f454c46");
    assert.equal(image[4], 2, "supported Linux archives are ELF64");
    assert.equal(
      image[5],
      1,
      "supported Linux architectures are little endian",
    );
    const offset = Number(image.readBigUInt64LE(32));
    const width = image.readUInt16LE(54),
      count = image.readUInt16LE(56);
    for (let i = 0; i < count; i++)
      assert.notEqual(
        image.readUInt32LE(offset + i * width),
        3,
        "static Linux archive must not require an ELF interpreter",
      );
  }
  if (process.platform === "win32") {
    // https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
    const pe = image.readUInt32LE(0x3c);
    assert.equal(image.subarray(pe, pe + 4).toString("hex"), "50450000");
    const optional = pe + 24;
    assert.equal(
      image.readUInt16LE(optional),
      0x20b,
      "supported Windows archives are PE32+",
    );
    const sections = optional + image.readUInt16LE(pe + 20),
      count = image.readUInt16LE(pe + 6);
    function position(rva) {
      for (let i = 0; i < count; i++) {
        const section = sections + i * 40,
          virtual = image.readUInt32LE(section + 12);
        const size = Math.max(
          image.readUInt32LE(section + 8),
          image.readUInt32LE(section + 16),
        );
        if (rva >= virtual && rva < virtual + size)
          return image.readUInt32LE(section + 20) + rva - virtual;
      }
      throw new Error(`Import RVA ${rva} is outside PE sections`);
    }
    const rva = image.readUInt32LE(optional + 112 + 8);
    assert.notEqual(
      rva,
      0,
      "native Windows CLI imports operating-system services",
    );
    let descriptor = position(rva);
    while (image.readUInt32LE(descriptor + 12) !== 0) {
      const nameOffset = position(image.readUInt32LE(descriptor + 12));
      const name = image
        .subarray(nameOffset, image.indexOf(0, nameOffset))
        .toString("ascii");
      assert.doesNotMatch(
        name,
        /^(vcruntime|msvcr|ucrtbase|api-ms-win-crt-)/i,
        "Windows archive must statically link its CRT",
      );
      descriptor += 20;
    }
  }
  assert.deepEqual(
    readdirSync(directory).sort(),
    [
      "LICENSE",
      "README.md",
      process.platform === "win32" ? "oq.exe" : "oq",
    ].sort(),
  );
  const fixture = join(temporary, "input.org");
  writeFileSync(fixture, "* Extracted 雪\n");
  assert.equal(
    run(join(directory, process.platform === "win32" ? "oq.exe" : "oq"), [
      "query",
      ".children[].title",
      fixture,
    ]),
    '"Extracted 雪"\n',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
