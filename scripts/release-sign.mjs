import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdtempSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const directory = resolve(process.argv[2] ?? ".result/release");
const key = process.env.RELEASE_GPG_PRIVATE_KEY;
const fingerprint = process.env.RELEASE_GPG_FINGERPRINT;
if (!key || !/^[A-Fa-f0-9]{40,64}$/.test(fingerprint ?? ""))
  throw new Error(
    "Release signing requires a private key and its exact fingerprint",
  );
const files = readdirSync(directory).filter((f) => /\.(tar\.gz|tgz)$/.test(f));
if (files.length === 0) throw new Error("No release archives to sign");
const home = mkdtempSync(join(directory, ".signing-"));
chmodSync(home, 0o700);
function gpg(args, input) {
  const result = spawnSync("gpg", ["--homedir", home, "--batch", ...args], {
    input,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gpg failed: ${result.stderr}`);
  return result.stdout;
}
try {
  gpg(["--import"], key);
  const listed = gpg(["--with-colons", "--list-secret-keys", fingerprint]);
  if (
    !listed
      .split("\n")
      .some(
        (line) =>
          line.startsWith("fpr:") &&
          line.split(":")[9] === fingerprint.toUpperCase(),
      )
  )
    throw new Error("Signing fingerprint does not match imported key");
  for (const file of files) {
    const path = join(directory, file);
    writeFileSync(
      `${path}.sha256`,
      `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${basename(path)}\n`,
    );
    for (const input of [path, `${path}.sha256`]) {
      gpg(
        [
          "--yes",
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "0",
          "--local-user",
          fingerprint,
          "--armor",
          "--detach-sign",
          "--output",
          `${input}.asc`,
          input,
        ],
        process.env.RELEASE_GPG_PASSPHRASE ?? "",
      );
    }
    console.log(`Signed ${file} and its checksum`);
  }
} finally {
  spawnSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"]);
  rmSync(home, { recursive: true, force: true });
}
