// Real disposable GPG key and cryptographic verification; no signing mocks.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
mkdirSync(".result", { recursive: true });
const temporary = mkdtempSync(resolve(".result/sign-test-"));
const home = join(temporary, "keys");
mkdirSync(home);
chmodSync(home, 0o700);
function gpg(args, expected = 0) {
  const result = spawnSync("gpg", ["--homedir", home, "--batch", ...args], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stderr);
  return result.stdout;
}
try {
  gpg([
    "--pinentry-mode",
    "loopback",
    "--passphrase",
    "",
    "--quick-generate-key",
    "oq test <test@example.invalid>",
    "ed25519",
    "sign",
    "0",
  ]);
  const fingerprint = gpg(["--with-colons", "--list-secret-keys"])
    .split("\n")
    .find((l) => l.startsWith("fpr:"))
    .split(":")[9];
  const key = gpg(["--armor", "--export-secret-keys", fingerprint]);
  const artifact = join(temporary, "oq-test.tar.gz");
  writeFileSync(artifact, "signed fixture 雪\n");
  const result = spawnSync(
    process.execPath,
    ["scripts/release-sign.mjs", temporary],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_GPG_PRIVATE_KEY: key,
        RELEASE_GPG_FINGERPRINT: fingerprint,
        RELEASE_GPG_PASSPHRASE: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  gpg(["--verify", `${artifact}.asc`, artifact]);
  gpg(["--verify", `${artifact}.sha256.asc`, `${artifact}.sha256`]);
  assert.equal(
    readFileSync(`${artifact}.sha256`, "utf8"),
    `${createHash("sha256").update(readFileSync(artifact)).digest("hex")}  oq-test.tar.gz\n`,
  );
  writeFileSync(artifact, "tampered\n");
  gpg(["--verify", `${artifact}.asc`, artifact], 1);
  assert.ok(!readdirSync(temporary).some((f) => f.startsWith(".signing-")));
  const missing = spawnSync(
    process.execPath,
    ["scripts/release-sign.mjs", temporary],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_GPG_PRIVATE_KEY: "",
        RELEASE_GPG_FINGERPRINT: "",
      },
    },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires a private key/);
  console.log(
    "Real signing, checksum, tamper rejection, cleanup, and missing-credential checks passed",
  );
} finally {
  spawnSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"]);
  rmSync(temporary, { recursive: true, force: true });
}
